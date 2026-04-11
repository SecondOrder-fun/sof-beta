// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../../src/account/SOFSmartAccount.sol";

/// @notice Deploy SOFSmartAccount singleton via CREATE2 for deterministic address.
contract DeploySOFSmartAccount is Script {
    // Zero salt for simplicity — address is deterministic across chains.
    bytes32 constant SALT = bytes32(0);

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        SOFSmartAccount account = new SOFSmartAccount{salt: SALT}();

        vm.stopBroadcast();

        console.log("SOFSmartAccount deployed to:", address(account));
        console.log("Chain ID:", block.chainid);
    }
}
