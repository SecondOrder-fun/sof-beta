// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {InfoFiFPMMV2} from "../../src/infofi/InfoFiFPMMV2.sol";

contract DeployFPMM is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        InfoFiFPMMV2 manager = new InfoFiFPMMV2(
            addrs.conditionalTokens,
            addrs.sofToken,
            deployer,
            deployer
        );

        vm.stopBroadcast();

        addrs.fpmmManager = address(manager);

        console2.log("InfoFiFPMMV2 (Manager):", address(manager));

        return addrs;
    }
}
