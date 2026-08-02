// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { BalanceDelta, toBalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import { V4StrategyHook } from "../src/V4StrategyHook.sol";
import { V4StrategyHookFactory } from "../src/V4StrategyHookFactory.sol";

contract StrategyMockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ReenteringRecipient {
    V4StrategyHook internal immutable hook;
    bool public attempted;
    bool public reentered;

    constructor(V4StrategyHook hook_) {
        hook = hook_;
    }

    receive() external payable {
        attempted = true;
        (reentered,) = address(hook).call(abi.encodeCall(V4StrategyHook.executeStrategy, ()));
    }
}

contract V4StrategyHookTest is Deployers {
    uint160 internal constant REQUIRED_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    StrategyMockToken internal launchToken;
    StrategyMockToken internal targetToken;
    V4StrategyHook internal hook;
    PoolKey internal canonicalKey;
    PoolKey internal targetKey;

    address internal creator;
    address internal executor;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public virtual {
        _setUpManagerAndRouters();
        vm.deal(address(this), 10_000 ether);
        creator = address(this);
        executor = makeAddr("executor");

        launchToken = new StrategyMockToken("Launch Token", "LAUNCH");
        targetToken = new StrategyMockToken("Target Token", "TARGET");
        launchToken.mint(address(this), 10_000_000 ether);
        targetToken.mint(address(this), 10_000_000 ether);
        launchToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        launchToken.approve(address(swapRouter), type(uint256).max);
        targetToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        targetToken.approve(address(swapRouter), type(uint256).max);

        targetKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(targetToken)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        manager.initialize(targetKey, SQRT_PRICE_1_1);
        ModifyLiquidityParams memory targetLiquidity =
            ModifyLiquidityParams({ tickLower: -600, tickUpper: 600, liquidityDelta: 100_000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 4000 ether }(targetKey, targetLiquidity, ZERO_BYTES);

        V4StrategyHook.StrategyConfig memory config = _config();
        (, bytes32 salt) = HookMiner.find(
            address(this), REQUIRED_FLAGS, type(V4StrategyHook).creationCode, abi.encode(manager, config)
        );
        hook = new V4StrategyHook{ salt: salt }(manager, config);

        canonicalKey = hook.canonicalPoolKey();
        manager.initialize(canonicalKey, SQRT_PRICE_1_1);
        ModifyLiquidityParams memory launchLiquidity =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 100_000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 4000 ether }(canonicalKey, launchLiquidity, ZERO_BYTES);
    }

    function _setUpManagerAndRouters() internal virtual {
        deployFreshManagerAndRouters();
    }

    function test_configurationIsImmutableAndCustom() public view {
        assertEq(hook.selectedBuyTotalFeeBps(), 100);
        assertEq(hook.selectedSellTotalFeeBps(), 200);
        assertEq(hook.effectiveBuyTotalFeeBps(), 100);
        assertEq(hook.effectiveSellTotalFeeBps(), 200);
        assertEq(hook.strategyShareBps(), 1000);
        assertEq(hook.canonicalLpFee(), 0);
        assertEq(hook.canonicalTickSpacing(), 200);
        assertEq(hook.targetLpFee(), 0);
        assertEq(hook.targetTickSpacing(), 60);
        assertEq(address(hook.targetHooks()), address(0));
        assertNotEq(PoolId.unwrap(hook.canonicalPoolId()), PoolId.unwrap(hook.targetPoolId()));
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, REQUIRED_FLAGS);

        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
    }

    function test_factoryCreate2AddressAndPermissionMaskAreReproducible() public {
        V4StrategyHookFactory factory = new V4StrategyHookFactory();
        V4StrategyHook.StrategyConfig memory config = _config();
        (address expected, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(V4StrategyHook).creationCode,
            abi.encode(manager, config)
        );
        assertEq(factory.computeAddress(salt, manager, config), expected);
        V4StrategyHook deployed = factory.deploy(salt, manager, config);
        assertEq(address(deployed), expected);
        assertEq(uint160(address(deployed)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS());
    }

    function test_buyGrossFeeUsesInclusiveTenNinetyProjectSplit() public view {
        (uint256 platform, uint256 creatorFee, uint256 strategy) = hook.feeBreakdownForGross(1 ether, true);
        assertEq(platform, 0.001 ether);
        assertEq(strategy, 0.0009 ether);
        assertEq(creatorFee, 0.0081 ether);
        assertEq(platform + creatorFee + strategy, 0.01 ether);
    }

    function test_zeroSelectedFeeStillCollectsOnlyProgrammableFloor() public {
        V4StrategyHook.StrategyConfig memory config = _config();
        config.selectedBuyTotalFeeBps = 0;
        config.selectedSellTotalFeeBps = 0;
        config.strategyShareBps = 10_000;
        (, bytes32 salt) = HookMiner.find(
            address(this), REQUIRED_FLAGS, type(V4StrategyHook).creationCode, abi.encode(manager, config)
        );
        V4StrategyHook floorHook = new V4StrategyHook{ salt: salt }(manager, config);
        (uint256 platform, uint256 creatorFee, uint256 strategy) = floorHook.feeBreakdownForGross(1 ether, true);
        assertEq(platform, 0.001 ether);
        assertEq(creatorFee, 0);
        assertEq(strategy, 0);
    }

    function test_buyExactInputAccruesAllLiabilities() public {
        _swap(true, -int256(10 ether), 10 ether);
        (uint256 platform, uint256 creatorFee, uint256 strategy) = hook.feeBreakdownForGross(10 ether, true);
        assertEq(hook.programmableFeesAccrued(), platform);
        assertEq(hook.creatorFeesAccrued(), creatorFee);
        assertEq(hook.strategyFeesAccrued(), strategy);
        assertEq(hook.totalNativeLiabilities(), platform + creatorFee + strategy);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), hook.totalNativeLiabilities());
    }

    function test_allFourSwapQuadrantsAccrue() public {
        _swap(true, -int256(1 ether), 1 ether);
        uint256 afterBuyExactInput = hook.totalNativeLiabilities();
        _swap(true, int256(0.1 ether), 2 ether);
        uint256 afterBuyExactOutput = hook.totalNativeLiabilities();
        _swap(false, -int256(0.1 ether), 0);
        uint256 afterSellExactInput = hook.totalNativeLiabilities();
        _swap(false, int256(0.01 ether), 0);
        assertGt(afterBuyExactInput, 0);
        assertGt(afterBuyExactOutput, afterBuyExactInput);
        assertGt(afterSellExactInput, afterBuyExactOutput);
        assertGt(hook.totalNativeLiabilities(), afterSellExactInput);
    }

    function test_creatorAndProgrammableClaimOnlyTheirLiabilities() public {
        _swap(true, -int256(10 ether), 10 ether);
        uint256 strategyBefore = hook.strategyFeesAccrued();
        uint256 creatorBefore = hook.creatorFeesAccrued();
        uint256 platformBefore = hook.programmableFeesAccrued();
        uint256 creatorBalanceBefore = creator.balance;

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(V4StrategyHook.CreatorOnly.selector, attacker, creator));
        hook.claimCreatorFees();

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(V4StrategyHook.FeeOwnerOnly.selector, attacker));
        hook.claimProgrammableFees(attacker);

        hook.claimCreatorFees();
        assertEq(creator.balance - creatorBalanceBefore, creatorBefore);
        address platformDestination = makeAddr("platformDestination");
        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        hook.claimProgrammableFees(platformDestination);
        assertEq(platformDestination.balance, platformBefore);
        assertEq(hook.totalNativeLiabilities(), strategyBefore);
    }

    function test_permissionlessExecutionBuysAndBurnsExactTargetOutput() public {
        _swap(true, -int256(100 ether), 100 ether);
        _buildOracleWindow();
        uint256 strategyBefore = hook.strategyFeesAccrued();
        uint256 burnBefore = targetToken.balanceOf(hook.BURN_RECIPIENT());

        vm.prank(executor);
        (uint256 amountIn, uint256 burned) = hook.executeStrategy();

        assertEq(amountIn, strategyBefore);
        assertGt(burned, 0);
        assertEq(targetToken.balanceOf(hook.BURN_RECIPIENT()) - burnBefore, burned);
        assertEq(targetToken.balanceOf(address(hook)), 0);
        assertEq(hook.strategyFeesAccrued(), 0);
        assertEq(hook.totalNativeExecuted(), amountIn);
        assertEq(hook.totalTargetBoughtAndBurned(), burned);
        assertEq(hook.executionCount(), 1);
    }

    function test_executionFailsClosedWithoutOracleWindow() public {
        _swap(true, -int256(100 ether), 100 ether);
        vm.expectRevert(V4StrategyHook.OracleNotReady.selector);
        hook.executeStrategy();
        assertGt(hook.strategyFeesAccrued(), 0);
    }

    function test_executionRejectsAtomicSpotManipulationAndPreservesLiability() public {
        _swap(true, -int256(100 ether), 100 ether);
        _buildOracleWindow();
        uint256 liabilityBefore = hook.strategyFeesAccrued();

        swapRouter.swap{ value: 1500 ether }(
            targetKey,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1500 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ""
        );

        vm.expectPartialRevert(V4StrategyHook.PriceDeviation.selector);
        hook.executeStrategy();
        assertEq(hook.strategyFeesAccrued(), liabilityBefore);
    }

    function test_cooldownBlocksSecondExecutionWithoutConsumingLiability() public {
        _swap(true, -int256(100 ether), 100 ether);
        _buildOracleWindow();
        hook.executeStrategy();

        _swap(true, -int256(100 ether), 100 ether);
        uint256 liabilityBefore = hook.strategyFeesAccrued();
        vm.expectPartialRevert(V4StrategyHook.CooldownActive.selector);
        hook.executeStrategy();
        assertEq(hook.strategyFeesAccrued(), liabilityBefore);
    }

    function test_observationGapResetsOracle() public {
        vm.warp(block.timestamp + hook.maxObservationGap() + 1);
        hook.recordObservation();
        assertEq(hook.observationCardinality(), 1);
    }

    function test_onlyPoolManagerCanEnterCallbacks() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), canonicalKey, SQRT_PRICE_1_1);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), canonicalKey, params, "");
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), canonicalKey, params, BalanceDelta.wrap(0), "");
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    function test_callbackSelectorsAndReturnShapesAreExact() public {
        vm.prank(address(manager));
        assertEq(hook.beforeInitialize(creator, canonicalKey, SQRT_PRICE_1_1), IHooks.beforeInitialize.selector);

        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1), sqrtPriceLimitX96: MIN_PRICE_LIMIT });
        vm.prank(address(manager));
        (bytes4 beforeSelector, BeforeSwapDelta beforeDelta, uint24 lpFeeOverride) =
            hook.beforeSwap(address(this), canonicalKey, params, "");
        assertEq(beforeSelector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(beforeDelta), 0);
        assertEq(lpFeeOverride, 0);

        vm.prank(address(manager));
        (bytes4 afterSelector, int128 afterDelta) =
            hook.afterSwap(address(this), canonicalKey, params, toBalanceDelta(-1, 1), "");
        assertEq(afterSelector, IHooks.afterSwap.selector);
        assertEq(afterDelta, 0);
    }

    function test_programmableClaimRecipientCannotReenterStrategy() public {
        _swap(true, -int256(10 ether), 10 ether);
        ReenteringRecipient recipient = new ReenteringRecipient(hook);
        uint256 platformBefore = hook.programmableFeesAccrued();

        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        hook.claimProgrammableFees(address(recipient));

        assertTrue(recipient.attempted());
        assertFalse(recipient.reentered());
        assertEq(address(recipient).balance, platformBefore);
        assertEq(hook.programmableFeesAccrued(), 0);
    }

    function testFuzz_feeConservation(uint96 rawAmount, bool isBuy) public view {
        uint256 amount = bound(uint256(rawAmount), 10_000, 100_000 ether);
        (uint256 platform, uint256 creatorFee, uint256 strategy) = hook.feeBreakdownForGross(amount, isBuy);
        uint16 rate = isBuy ? hook.effectiveBuyTotalFeeBps() : hook.effectiveSellTotalFeeBps();
        assertEq(platform + creatorFee + strategy, amount * rate / 10_000);
        assertEq(platform, amount * hook.PROGRAMMABLE_FEE_BPS() / 10_000);
    }

    function _config() private view returns (V4StrategyHook.StrategyConfig memory) {
        return V4StrategyHook.StrategyConfig({
            creator: creator,
            launchToken: address(launchToken),
            targetToken: address(targetToken),
            selectedBuyTotalFeeBps: 100,
            selectedSellTotalFeeBps: 200,
            strategyShareBps: 1000,
            executionThreshold: 0.001 ether,
            cooldown: 2 hours,
            oracleWindow: 30 minutes,
            minObservationSpacing: 5 minutes,
            maxObservationGap: 10 minutes,
            maxSlippageBps: 500,
            maxTwapDeviationTicks: 200,
            maxPriceImpactTicks: 500,
            canonicalLpFee: 0,
            canonicalTickSpacing: 200,
            targetLpFee: 0,
            targetTickSpacing: 60,
            targetHooks: IHooks(address(0))
        });
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            canonicalKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _buildOracleWindow() private {
        for (uint256 i = 0; i < 6; i++) {
            vm.warp(block.timestamp + 5 minutes);
            hook.recordObservation();
        }
    }
}
