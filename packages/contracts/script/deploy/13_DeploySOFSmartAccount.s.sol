// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFSmartAccount} from "../../src/account/SOFSmartAccount.sol";

contract DeploySOFSmartAccount is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        SOFSmartAccount account = new SOFSmartAccount{salt: bytes32(0)}();

        vm.stopBroadcast();

        addrs.sofSmartAccount = address(account);

        console2.log("SOFSmartAccount:", address(account));

        return addrs;
    }
}
