// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import { V4StrategyHookTest } from "./V4StrategyHook.t.sol";

/// @notice Runs the complete inherited lifecycle against the official Ethereum PoolManager at one exact block.
contract V4StrategyHookPinnedForkTest is V4StrategyHookTest {
    address internal constant MAINNET_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    uint256 internal constant PINNED_MAINNET_BLOCK = 25_664_100;
    bytes32 internal constant EXPECTED_POOL_MANAGER_RUNTIME_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;

    function setUp() public override {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"), PINNED_MAINNET_BLOCK);
        assertEq(block.chainid, 1);
        assertEq(MAINNET_POOL_MANAGER.codehash, EXPECTED_POOL_MANAGER_RUNTIME_HASH);
        super.setUp();
    }

    function _setUpManagerAndRouters() internal override {
        manager = IPoolManager(MAINNET_POOL_MANAGER);
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);
    }
}

/// @notice A separate current-head check detects deployment drift without weakening the pinned regression suite.
contract V4StrategyHookCurrentHeadSmokeTest is Test {
    address internal constant MAINNET_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant EXPECTED_POOL_MANAGER_RUNTIME_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;

    function test_currentHeadPoolManagerRuntimeMatches() public {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"));
        assertEq(block.chainid, 1);
        assertGt(block.number, 25_664_100);
        assertEq(MAINNET_POOL_MANAGER.codehash, EXPECTED_POOL_MANAGER_RUNTIME_HASH);
    }
}
