// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFSmartAccount} from "../../src/account/SOFSmartAccount.sol";

contract DeploySOFSmartAccount is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        // Use regular CREATE for local/testnet. CREATE2 with salt 0 causes
        // collision errors when forge re-simulates after a prior run.
        // NOTE: this script is scheduled for deletion in Task 1.6 of the
        // gasless rewrite plan (replaced by the factory deploy at 13a). The
        // argument here keeps the file compiling against the new constructor
        // signature; the canonical onboarding flow is via the factory.
        SOFSmartAccount account = new SOFSmartAccount(msg.sender);
        vm.stopBroadcast();

        addrs.sofSmartAccount = address(account);
        console2.log("SOFSmartAccount:", address(account));

        return addrs;
    }
}
