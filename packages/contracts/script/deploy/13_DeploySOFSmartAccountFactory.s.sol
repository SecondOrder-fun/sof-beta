// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFSmartAccountFactory} from "../../src/account/SOFSmartAccountFactory.sol";

/// @title DeploySOFSmartAccountFactory
/// @notice Deploys the deterministic CREATE2 factory that mints one
///         {SOFSmartAccount} per EOA owner. Per-EOA SMAs are NOT deployed
///         here — they are deployed lazily by `factory.createAccount(owner)`
///         (or the EntryPoint initCode path) on the first sponsored UserOp.
contract DeploySOFSmartAccountFactory is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        // No-arg ctor: factory only needs to know its own bytecode + salt
        // scheme; the EntryPoint reference lives on the SMA via its inherited
        // ERC4337-account base, not on the factory.
        SOFSmartAccountFactory factory = new SOFSmartAccountFactory();
        vm.stopBroadcast();

        addrs.sofSmartAccountFactory = address(factory);
        console2.log("SOFSmartAccountFactory:", address(factory));

        return addrs;
    }
}
