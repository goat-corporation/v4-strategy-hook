// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import { V4StrategyHookTest } from "./V4StrategyHook.t.sol";

contract StrategyInvariantHandler {
    PoolSwapTest public immutable router;
    PoolKey internal key;
    IERC20 public immutable token;
    uint256 public totalCalls;
    uint256 public successfulCalls;
    uint256 public revertedCalls;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(PoolSwapTest router_, PoolKey memory key_, IERC20 token_) payable {
        router = router_;
        key = key_;
        token = token_;
        token_.approve(address(router_), type(uint256).max);
    }

    receive() external payable { }

    function buyExactInput(uint96 rawAmount) external {
        totalCalls++;
        uint256 amount = uint256(rawAmount) % 0.25 ether + 1 gwei;
        if (address(this).balance < amount) {
            revertedCalls++;
            return;
        }
        // `amount` originates from uint96, so this conversion cannot exceed int256.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 signedAmount = int256(amount);
        try router.swap{ value: amount }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -signedAmount, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        ) {
            successfulCalls++;
        } catch {
            revertedCalls++;
        }
    }

    function sellExactInput(uint96 rawAmount) external {
        totalCalls++;
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) {
            revertedCalls++;
            return;
        }
        uint256 amount = uint256(rawAmount) % balance + 1;
        // Test token balances cannot approach int256.max in this bounded fixture.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 signedAmount = int256(amount);
        try router.swap(
            key,
            SwapParams({
                zeroForOne: false, amountSpecified: -signedAmount, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        ) {
            successfulCalls++;
        } catch {
            revertedCalls++;
        }
    }
}

contract V4StrategyHookInvariantTest is V4StrategyHookTest {
    StrategyInvariantHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler =
            new StrategyInvariantHandler{ value: 100 ether }(swapRouter, canonicalKey, IERC20(address(launchToken)));
        assertTrue(launchToken.transfer(address(handler), 100 ether));
        targetContract(address(handler));
    }

    function invariant_liabilitiesAreExactlyPartitionedAndBacked() public view {
        uint256 liabilities = hook.programmableFeesAccrued() + hook.creatorFeesAccrued() + hook.strategyFeesAccrued();
        assertEq(hook.totalNativeLiabilities(), liabilities);
        assertGe(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), hook.totalNativeLiabilities());
    }

    function invariant_configurationAndPermissionsNeverChange() public view {
        assertEq(hook.selectedBuyTotalFeeBps(), 100);
        assertEq(hook.selectedSellTotalFeeBps(), 200);
        assertEq(hook.strategyShareBps(), 1000);
        assertEq(hook.creator(), creator);
        assertEq(hook.launchToken(), address(launchToken));
        assertEq(hook.targetToken(), address(targetToken));
    }

    function invariant_usefulAndRevertCountersAreObservable() public view {
        assertEq(handler.successfulCalls() + handler.revertedCalls(), handler.totalCalls());
    }
}
