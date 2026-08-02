// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title V4StrategyHook
/// @notice A one-launch-pool hook that charges an inclusive quote-side fee, reserves Programmable's fixed share,
///         splits the project remainder between its creator and a permissionless buyback-and-burn strategy, and
///         executes the strategy through a separate ETH/target-token v4 pool.
/// @dev Prototype only. The contract is non-upgradeable, has no owner, pause, rescue, arbitrary call, mutable fee,
///      mutable recipient, or privileged keeper. Each deployment is bound to one canonical launch pool.
contract V4StrategyHook is BaseHook, IUnlockCallback, ReentrancyGuardTransient {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using PoolIdLibrary for PoolKey;
    using SafeCast for *;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant PROGRAMMABLE_FEE_BPS = 10;
    uint16 public constant MAX_TOTAL_FEE_BPS = 1000;
    uint16 public constant MAX_STRATEGY_SHARE_BPS = BASIS_POINTS;
    uint8 public constant OBSERVATION_CAPACITY = 16;
    address public constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant BURN_RECIPIENT = 0x000000000000000000000000000000000000dEaD;

    Currency private constant NATIVE = Currency.wrap(address(0));

    struct StrategyConfig {
        address creator;
        address launchToken;
        address targetToken;
        uint16 selectedBuyTotalFeeBps;
        uint16 selectedSellTotalFeeBps;
        uint16 strategyShareBps;
        uint128 executionThreshold;
        uint32 cooldown;
        uint32 oracleWindow;
        uint32 minObservationSpacing;
        uint32 maxObservationGap;
        uint16 maxSlippageBps;
        int24 maxTwapDeviationTicks;
        int24 maxPriceImpactTicks;
        uint24 canonicalLpFee;
        int24 canonicalTickSpacing;
        uint24 targetLpFee;
        int24 targetTickSpacing;
        IHooks targetHooks;
    }

    struct Observation {
        uint32 timestamp;
        int56 tickCumulative;
        int24 tick;
    }

    address public immutable creator;
    address public immutable launchToken;
    address public immutable targetToken;
    uint16 public immutable selectedBuyTotalFeeBps;
    uint16 public immutable selectedSellTotalFeeBps;
    uint16 public immutable effectiveBuyTotalFeeBps;
    uint16 public immutable effectiveSellTotalFeeBps;
    uint16 public immutable strategyShareBps;
    uint128 public immutable executionThreshold;
    uint32 public immutable cooldown;
    uint32 public immutable oracleWindow;
    uint32 public immutable minObservationSpacing;
    uint32 public immutable maxObservationGap;
    uint16 public immutable maxSlippageBps;
    int24 public immutable maxTwapDeviationTicks;
    int24 public immutable maxPriceImpactTicks;

    uint24 public immutable canonicalLpFee;
    int24 public immutable canonicalTickSpacing;
    uint24 public immutable targetLpFee;
    int24 public immutable targetTickSpacing;
    IHooks public immutable targetHooks;
    PoolId public immutable canonicalPoolId;
    PoolId public immutable targetPoolId;

    uint256 public programmableFeesAccrued;
    uint256 public creatorFeesAccrued;
    uint256 public strategyFeesAccrued;
    uint256 public totalNativeLiabilities;
    uint256 public totalTargetBoughtAndBurned;
    uint256 public totalNativeExecuted;
    uint64 public executionCount;
    uint32 public lastExecutionTimestamp;

    Observation[OBSERVATION_CAPACITY] public observations;
    uint8 public observationIndex;
    uint8 public observationCardinality;

    error CanonicalPoolMismatch(bytes32 actual, bytes32 expected);
    error CooldownActive(uint256 nextExecutionTimestamp);
    error CreatorOnly(address caller, address expected);
    error FeeOwnerOnly(address caller);
    error InsufficientStrategyFees(uint256 available, uint256 threshold);
    error InvalidAddress();
    error InvalidConfiguration();
    error InvalidPoolShape();
    error InvalidRecipient();
    error NoFeesToClaim();
    error ObservationTooSoon(uint256 elapsed, uint256 minimum);
    error OracleNotReady();
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PriceDeviation(int24 spotTick, int24 twapTick, int24 maximumDeviation);
    error SamePoolStrategyForbidden();
    error SlippageExceeded(uint256 actualOutput, uint256 minimumOutput);
    error TargetTransferMismatch(uint256 bought, uint256 burned);
    error UnexpectedUnlockResult();
    error UnauthorizedInitializer(address caller, address expected);
    error UnknownUnlockAction(uint8 action);

    event NativeFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
        bool indexed isBuy,
        uint16 effectiveTotalFeeBps,
        uint256 grossNativeAmount,
        uint256 programmableFee,
        uint256 creatorFee,
        uint256 strategyFee
    );
    event ProgrammableFeesClaimed(address indexed recipient, uint256 amount);
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event OracleObservation(uint32 indexed timestamp, int24 tick, int56 tickCumulative, bool reset);
    event StrategyExecuted(
        address indexed executor,
        uint256 nativeAmountIn,
        uint256 targetAmountBurned,
        int24 twapTick,
        int24 spotTick,
        uint256 minimumOutput
    );

    constructor(IPoolManager poolManager_, StrategyConfig memory config) BaseHook(poolManager_) {
        if (
            address(poolManager_) == address(0) || config.creator == address(0) || config.launchToken == address(0)
                || config.targetToken == address(0) || address(config.targetHooks) == address(this)
        ) revert InvalidAddress();
        if (
            config.selectedBuyTotalFeeBps > MAX_TOTAL_FEE_BPS || config.selectedSellTotalFeeBps > MAX_TOTAL_FEE_BPS
                || config.strategyShareBps > MAX_STRATEGY_SHARE_BPS || config.canonicalTickSpacing <= 0
                || config.targetTickSpacing <= 0 || config.executionThreshold == 0 || config.cooldown == 0
                || config.oracleWindow == 0 || config.minObservationSpacing == 0
                || config.maxObservationGap < config.minObservationSpacing
                || config.oracleWindow < config.minObservationSpacing || config.maxSlippageBps == 0
                || config.maxSlippageBps > 2000 || config.maxTwapDeviationTicks <= 0 || config.maxPriceImpactTicks <= 0
        ) revert InvalidConfiguration();

        creator = config.creator;
        launchToken = config.launchToken;
        targetToken = config.targetToken;
        selectedBuyTotalFeeBps = config.selectedBuyTotalFeeBps;
        selectedSellTotalFeeBps = config.selectedSellTotalFeeBps;
        effectiveBuyTotalFeeBps =
            config.selectedBuyTotalFeeBps < PROGRAMMABLE_FEE_BPS ? PROGRAMMABLE_FEE_BPS : config.selectedBuyTotalFeeBps;
        effectiveSellTotalFeeBps = config.selectedSellTotalFeeBps < PROGRAMMABLE_FEE_BPS
            ? PROGRAMMABLE_FEE_BPS
            : config.selectedSellTotalFeeBps;
        strategyShareBps = config.strategyShareBps;
        executionThreshold = config.executionThreshold;
        cooldown = config.cooldown;
        oracleWindow = config.oracleWindow;
        minObservationSpacing = config.minObservationSpacing;
        maxObservationGap = config.maxObservationGap;
        maxSlippageBps = config.maxSlippageBps;
        maxTwapDeviationTicks = config.maxTwapDeviationTicks;
        maxPriceImpactTicks = config.maxPriceImpactTicks;
        canonicalLpFee = config.canonicalLpFee;
        canonicalTickSpacing = config.canonicalTickSpacing;
        targetLpFee = config.targetLpFee;
        targetTickSpacing = config.targetTickSpacing;
        targetHooks = config.targetHooks;

        PoolKey memory canonical = _canonicalPoolKey();
        PoolKey memory target = _targetPoolKey();
        canonicalPoolId = canonical.toId();
        targetPoolId = target.toId();
        if (PoolId.unwrap(canonicalPoolId) == PoolId.unwrap(targetPoolId)) revert SamePoolStrategyForbidden();

        (uint160 targetSqrtPriceX96, int24 targetTick,,) = poolManager_.getSlot0(targetPoolId);
        if (targetSqrtPriceX96 == 0) revert InvalidPoolShape();
        _initializeObservation(targetTick);
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert InvalidAddress();
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function canonicalPoolKey() external view returns (PoolKey memory) {
        return _canonicalPoolKey();
    }

    function targetPoolKey() external view returns (PoolKey memory) {
        return _targetPoolKey();
    }

    function feeBreakdownForGross(uint256 grossNativeAmount, bool isBuy)
        public
        view
        returns (uint256 programmableFee, uint256 creatorFee, uint256 strategyFee)
    {
        uint16 effectiveTotalFeeBps = isBuy ? effectiveBuyTotalFeeBps : effectiveSellTotalFeeBps;
        uint256 totalFee = FullMath.mulDiv(grossNativeAmount, effectiveTotalFeeBps, BASIS_POINTS);
        programmableFee = FullMath.mulDiv(grossNativeAmount, PROGRAMMABLE_FEE_BPS, BASIS_POINTS);
        if (programmableFee > totalFee) programmableFee = totalFee;
        uint256 projectFee = totalFee - programmableFee;
        strategyFee = FullMath.mulDiv(projectFee, strategyShareBps, BASIS_POINTS);
        creatorFee = projectFee - strategyFee;
    }

    function feeBreakdownForNet(uint256 netNativeAmount, bool isBuy)
        public
        view
        returns (uint256 programmableFee, uint256 creatorFee, uint256 strategyFee)
    {
        uint16 effectiveTotalFeeBps = isBuy ? effectiveBuyTotalFeeBps : effectiveSellTotalFeeBps;
        uint256 grossNativeAmount =
            FullMath.mulDivRoundingUp(netNativeAmount, BASIS_POINTS, BASIS_POINTS - effectiveTotalFeeBps);
        uint256 totalFee = grossNativeAmount - netNativeAmount;
        programmableFee = FullMath.mulDiv(grossNativeAmount, PROGRAMMABLE_FEE_BPS, BASIS_POINTS);
        if (programmableFee > totalFee) programmableFee = totalFee;
        uint256 projectFee = totalFee - programmableFee;
        strategyFee = FullMath.mulDiv(projectFee, strategyShareBps, BASIS_POINTS);
        creatorFee = projectFee - strategyFee;
    }

    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != creator) revert CreatorOnly(msg.sender, creator);
        amount = creatorFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();
        creatorFeesAccrued = 0;
        totalNativeLiabilities -= amount;
        _redeemNative(creator, amount);
        emit CreatorFeesClaimed(creator, amount);
    }

    function claimProgrammableFees(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != PROGRAMMABLE_FEE_OWNER) revert FeeOwnerOnly(msg.sender);
        if (recipient == address(0)) revert InvalidRecipient();
        amount = programmableFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();
        programmableFeesAccrued = 0;
        totalNativeLiabilities -= amount;
        _redeemNative(recipient, amount);
        emit ProgrammableFeesClaimed(recipient, amount);
    }

    /// @notice Records a target-pool tick sample. Anyone may maintain the oracle; samples that are too frequent revert.
    function recordObservation() external returns (uint32 timestamp, int24 tick, int56 tickCumulative) {
        (, tick,,) = poolManager.getSlot0(targetPoolId);
        (timestamp, tickCumulative) = _writeObservation(tick, true);
    }

    /// @notice Executes all accrued strategy ETH as an exact-input target-token purchase and burns the exact output.
    /// @dev The caller supplies no price or destination. Oracle, slippage, impact, target and burn rules are immutable.
    function executeStrategy() external nonReentrant returns (uint256 amountIn, uint256 amountBurned) {
        amountIn = strategyFeesAccrued;
        if (amountIn < executionThreshold) revert InsufficientStrategyFees(amountIn, executionThreshold);
        uint256 nextExecution = uint256(lastExecutionTimestamp) + cooldown;
        if (executionCount != 0 && block.timestamp < nextExecution) revert CooldownActive(nextExecution);

        (, int24 spotTick,,) = poolManager.getSlot0(targetPoolId);
        _writeObservation(spotTick, false);
        int24 twapTick = _consultTwap();
        int24 deviation = spotTick >= twapTick ? spotTick - twapTick : twapTick - spotTick;
        if (deviation > maxTwapDeviationTicks) revert PriceDeviation(spotTick, twapTick, maxTwapDeviationTicks);

        uint256 minimumOutput =
            FullMath.mulDiv(_quoteAtTick(twapTick, amountIn), BASIS_POINTS - maxSlippageBps, BASIS_POINTS);
        if (minimumOutput == 0) revert InvalidConfiguration();

        strategyFeesAccrued = 0;
        totalNativeLiabilities -= amountIn;
        lastExecutionTimestamp = uint32(block.timestamp);

        uint256 hookBalanceBefore = IERC20(targetToken).balanceOf(address(this));
        bytes memory result =
            poolManager.unlock(abi.encode(uint8(2), amountIn, _sqrtPriceLimit(spotTick), minimumOutput));
        if (result.length != 32) revert UnexpectedUnlockResult();
        uint256 bought = abi.decode(result, (uint256));
        if (bought < minimumOutput) revert SlippageExceeded(bought, minimumOutput);
        if (IERC20(targetToken).balanceOf(address(this)) - hookBalanceBefore != bought) {
            revert TargetTransferMismatch(bought, IERC20(targetToken).balanceOf(address(this)) - hookBalanceBefore);
        }

        uint256 burnerBalanceBefore = IERC20(targetToken).balanceOf(BURN_RECIPIENT);
        IERC20(targetToken).safeTransfer(BURN_RECIPIENT, bought);
        amountBurned = IERC20(targetToken).balanceOf(BURN_RECIPIENT) - burnerBalanceBefore;
        if (amountBurned != bought || IERC20(targetToken).balanceOf(address(this)) != hookBalanceBefore) {
            revert TargetTransferMismatch(bought, amountBurned);
        }

        totalNativeExecuted += amountIn;
        totalTargetBoughtAndBurned += amountBurned;
        executionCount += 1;
        emit StrategyExecuted(msg.sender, amountIn, amountBurned, twapTick, spotTick, minimumOutput);
    }

    function currentTwapTick() external view returns (int24) {
        return _consultTwap();
    }

    function quoteMinimumOutput(uint256 amountIn) external view returns (uint256) {
        return FullMath.mulDiv(_quoteAtTick(_consultTwap(), amountIn), BASIS_POINTS - maxSlippageBps, BASIS_POINTS);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        uint8 action = abi.decode(data, (uint8));
        if (action == 1) {
            (, address recipient, uint256 amount) = abi.decode(data, (uint8, address, uint256));
            NATIVE.settle(poolManager, address(this), amount, true);
            NATIVE.take(poolManager, recipient, amount, false);
            return "";
        }
        if (action == 2) {
            (, uint256 amountIn, uint160 sqrtPriceLimitX96, uint256 minimumOutput) =
                abi.decode(data, (uint8, uint256, uint160, uint256));
            BalanceDelta delta = poolManager.swap(
                _targetPoolKey(),
                SwapParams({
                    zeroForOne: true, amountSpecified: -amountIn.toInt256(), sqrtPriceLimitX96: sqrtPriceLimitX96
                }),
                ""
            );
            uint256 nativeDebt = _absolute(int256(delta.amount0()));
            uint256 targetCredit = int256(delta.amount1()).toUint256();
            if (nativeDebt != amountIn) revert PartialFillUnsupported(amountIn, nativeDebt);
            if (targetCredit < minimumOutput) revert SlippageExceeded(targetCredit, minimumOutput);
            NATIVE.settle(poolManager, address(this), nativeDebt, true);
            Currency.wrap(targetToken).take(poolManager, address(this), targetCredit, false);
            return abi.encode(targetCredit);
        }
        revert UnknownUnlockAction(action);
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        _validateCanonicalPool(key);
        if (sender != creator) revert UnauthorizedInitializer(sender, creator);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _validateCanonicalPool(key);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 nativeAmount = _absolute(params.amountSpecified);
        uint256 totalFee = _chargeNative(sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        if (totalFee == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        _validateCanonicalPool(key);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (nativeIsSpecified) {
            uint256 requestedNativeAmount = _absolute(params.amountSpecified);
            (uint256 programmableFee, uint256 creatorFee, uint256 strategyFee) = params.amountSpecified > 0
                ? feeBreakdownForNet(requestedNativeAmount, params.zeroForOne)
                : feeBreakdownForGross(requestedNativeAmount, params.zeroForOne);
            uint256 chargedFee = programmableFee + creatorFee + strategyFee;
            uint256 expectedNativePoolAmount =
                params.amountSpecified > 0 ? requestedNativeAmount + chargedFee : requestedNativeAmount - chargedFee;
            uint256 actualNativePoolAmount = _absolute(int256(delta.amount0()));
            if (actualNativePoolAmount != expectedNativePoolAmount) {
                revert PartialFillUnsupported(expectedNativePoolAmount, actualNativePoolAmount);
            }
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 nativeAmount = _absolute(int256(delta.amount0()));
        uint256 totalFee = _chargeNative(sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
    }

    function _chargeNative(address sender, uint256 nativeAmount, bool amountIsNet, bool isBuy)
        private
        returns (uint256 totalFee)
    {
        uint16 appliedFeeBps = isBuy ? effectiveBuyTotalFeeBps : effectiveSellTotalFeeBps;
        (uint256 programmableFee, uint256 creatorFee, uint256 strategyFee) =
            amountIsNet ? feeBreakdownForNet(nativeAmount, isBuy) : feeBreakdownForGross(nativeAmount, isBuy);
        totalFee = programmableFee + creatorFee + strategyFee;
        if (totalFee == 0) return 0;

        programmableFeesAccrued += programmableFee;
        creatorFeesAccrued += creatorFee;
        strategyFeesAccrued += strategyFee;
        totalNativeLiabilities += totalFee;
        NATIVE.take(poolManager, address(this), totalFee, true);

        emit NativeFeesAccrued(
            PoolId.unwrap(canonicalPoolId),
            sender,
            isBuy,
            appliedFeeBps,
            nativeAmount + (amountIsNet ? totalFee : 0),
            programmableFee,
            creatorFee,
            strategyFee
        );
    }

    function _redeemNative(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(uint8(1), recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    function _canonicalPoolKey() private view returns (PoolKey memory) {
        return PoolKey({
            currency0: NATIVE,
            currency1: Currency.wrap(launchToken),
            fee: canonicalLpFee,
            tickSpacing: canonicalTickSpacing,
            hooks: IHooks(address(this))
        });
    }

    function _targetPoolKey() private view returns (PoolKey memory) {
        return PoolKey({
            currency0: NATIVE,
            currency1: Currency.wrap(targetToken),
            fee: targetLpFee,
            tickSpacing: targetTickSpacing,
            hooks: targetHooks
        });
    }

    function _validateCanonicalPool(PoolKey calldata key) private view {
        if (
            Currency.unwrap(key.currency0) != address(0) || Currency.unwrap(key.currency1) != launchToken
                || key.fee != canonicalLpFee || key.tickSpacing != canonicalTickSpacing
                || address(key.hooks) != address(this)
        ) revert InvalidPoolShape();
        bytes32 actual = PoolId.unwrap(key.toId());
        bytes32 expected = PoolId.unwrap(canonicalPoolId);
        if (actual != expected) revert CanonicalPoolMismatch(actual, expected);
    }

    function _initializeObservation(int24 tick) private {
        uint32 timestamp = uint32(block.timestamp);
        observations[0] = Observation({ timestamp: timestamp, tickCumulative: 0, tick: tick });
        observationIndex = 0;
        observationCardinality = 1;
        emit OracleObservation(timestamp, tick, 0, false);
    }

    function _writeObservation(int24 currentTick, bool strict)
        private
        returns (uint32 timestamp, int56 tickCumulative)
    {
        timestamp = uint32(block.timestamp);
        Observation memory last = observations[observationIndex];
        uint32 elapsed = timestamp - last.timestamp;
        if (elapsed < minObservationSpacing) {
            if (strict) revert ObservationTooSoon(elapsed, minObservationSpacing);
            return (last.timestamp, last.tickCumulative);
        }
        if (elapsed > maxObservationGap) {
            observations[0] = Observation({ timestamp: timestamp, tickCumulative: 0, tick: currentTick });
            observationIndex = 0;
            observationCardinality = 1;
            emit OracleObservation(timestamp, currentTick, 0, true);
            return (timestamp, 0);
        }

        tickCumulative = last.tickCumulative + int56(last.tick) * int56(uint56(elapsed));
        uint8 next = (observationIndex + 1) % OBSERVATION_CAPACITY;
        observations[next] = Observation({ timestamp: timestamp, tickCumulative: tickCumulative, tick: currentTick });
        observationIndex = next;
        if (observationCardinality < OBSERVATION_CAPACITY) observationCardinality += 1;
        emit OracleObservation(timestamp, currentTick, tickCumulative, false);
    }

    function _consultTwap() private view returns (int24 twapTick) {
        if (observationCardinality < 2) revert OracleNotReady();
        Observation memory latest = observations[observationIndex];
        uint32 now32 = uint32(block.timestamp);
        uint32 latestElapsed = now32 - latest.timestamp;
        if (latestElapsed > maxObservationGap) revert OracleNotReady();
        int56 currentCumulative = latest.tickCumulative + int56(latest.tick) * int56(uint56(latestElapsed));
        uint32 targetTimestamp = now32 - oracleWindow;

        bool found;
        Observation memory anchor;
        for (uint8 i = 0; i < observationCardinality; i++) {
            uint8 index = uint8((uint16(observationIndex) + OBSERVATION_CAPACITY - i) % OBSERVATION_CAPACITY);
            Observation memory candidate = observations[index];
            if (candidate.timestamp <= targetTimestamp) {
                anchor = candidate;
                found = true;
                break;
            }
        }
        if (!found) revert OracleNotReady();

        uint32 elapsed = now32 - anchor.timestamp;
        int56 numerator = currentCumulative - anchor.tickCumulative;
        int56 denominator = int56(uint56(elapsed));
        int56 average = numerator / denominator;
        if (numerator < 0 && numerator % denominator != 0) average--;
        // `average` is a time-weighted mean of int24 PoolManager ticks, so it remains inside int24 bounds.
        // forge-lint: disable-next-line(unsafe-typecast)
        twapTick = int24(average);
    }

    function _quoteAtTick(int24 tick, uint256 amountIn) private pure returns (uint256 amountOut) {
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            amountOut = FullMath.mulDiv(ratioX192, amountIn, 1 << 192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            amountOut = FullMath.mulDiv(ratioX128, amountIn, 1 << 128);
        }
    }

    function _sqrtPriceLimit(int24 spotTick) private view returns (uint160) {
        int24 limitTick = spotTick - maxPriceImpactTicks;
        if (limitTick <= TickMath.MIN_TICK) return TickMath.MIN_SQRT_PRICE + 1;
        return TickMath.getSqrtPriceAtTick(limitTick);
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
