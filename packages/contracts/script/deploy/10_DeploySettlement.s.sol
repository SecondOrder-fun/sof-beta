// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {InfoFiSettlement} from "../../src/infofi/InfoFiSettlement.sol";

contract DeploySettlement is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        InfoFiSettlement settlement = new InfoFiSettlement(deployer, addrs.raffle);

        vm.stopBroadcast();

        addrs.infoFiSettlement = address(settlement);

        console2.log("InfoFiSettlement:", address(settlement));

        return addrs;
    }
}
