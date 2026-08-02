// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { V4StrategyHook } from "./V4StrategyHook.sol";

/// @title V4StrategyHookFactory
/// @notice Permissionless CREATE2 deployer for launch-time-customized, immutable V4StrategyHook instances.
contract V4StrategyHookFactory {
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    uint160 public constant ALL_HOOK_MASK = Hooks.ALL_HOOK_MASK;

    event StrategyHookDeployed(
        address indexed hook,
        address indexed creator,
        address indexed launchToken,
        address targetToken,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(bytes32 salt, IPoolManager poolManager, V4StrategyHook.StrategyConfig calldata config)
        external
        returns (V4StrategyHook hook)
    {
        hook = new V4StrategyHook{ salt: salt }(poolManager, config);
        emit StrategyHookDeployed(
            address(hook),
            config.creator,
            config.launchToken,
            config.targetToken,
            salt,
            keccak256(abi.encode(poolManager, config))
        );
    }

    function creationCodeHash(IPoolManager poolManager, V4StrategyHook.StrategyConfig calldata config)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(type(V4StrategyHook).creationCode, abi.encode(poolManager, config)));
    }

    function computeAddress(bytes32 salt, IPoolManager poolManager, V4StrategyHook.StrategyConfig calldata config)
        external
        view
        returns (address predicted)
    {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(V4StrategyHook).creationCode, abi.encode(poolManager, config)));
        predicted =
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
