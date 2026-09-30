// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LaunchPoolGate} from "../../src/launchpad/LaunchPoolGate.sol";
import {HookMiner} from "../../src/launchpad/HookMiner.sol";

/// @dev Deploys a LaunchPoolGate at a mined address carrying exactly the
///      before-initialize hook bit, from the inheriting test contract.
abstract contract LaunchPoolGateDeployer {
    function _deployGate(address placer) internal returns (address) {
        bytes memory initCode = abi.encodePacked(type(LaunchPoolGate).creationCode, abi.encode(placer));
        (address expected, bytes32 salt) = HookMiner.find(address(this), Hooks.BEFORE_INITIALIZE_FLAG, initCode);
        // A second gate for the same placer mines the same salt; skip addresses in use.
        while (expected.code.length > 0) {
            (expected, salt) =
                HookMiner.findFrom(address(this), Hooks.BEFORE_INITIALIZE_FLAG, initCode, uint256(salt) + 1);
        }
        LaunchPoolGate gate = new LaunchPoolGate{salt: salt}(placer);
        require(address(gate) == expected, "gate address mismatch");
        return address(gate);
    }
}
