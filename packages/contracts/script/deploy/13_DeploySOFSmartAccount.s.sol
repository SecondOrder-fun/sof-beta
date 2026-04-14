// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFSmartAccount} from "../../src/account/SOFSmartAccount.sol";

contract DeploySOFSmartAccount is Script {
    bytes32 constant SALT = bytes32(0);

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        // Compute the CREATE2 address deterministically
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        address predicted = vm.computeCreate2Address(
            SALT,
            hashInitCode(type(SOFSmartAccount).creationCode),
            deployer
        );

        // Skip if already deployed (idempotent for re-runs)
        if (predicted.code.length > 0) {
            console2.log("SOFSmartAccount already deployed at:", predicted);
            addrs.sofSmartAccount = predicted;
            return addrs;
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        SOFSmartAccount account = new SOFSmartAccount{salt: SALT}();
        vm.stopBroadcast();

        addrs.sofSmartAccount = address(account);
        console2.log("SOFSmartAccount:", address(account));

        return addrs;
    }
}
