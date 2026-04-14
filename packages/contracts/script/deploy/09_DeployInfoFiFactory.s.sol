// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {InfoFiMarketFactory} from "../../src/infofi/InfoFiMarketFactory.sol";

contract DeployInfoFiFactory is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        InfoFiMarketFactory factory = new InfoFiMarketFactory(
            addrs.raffle,
            addrs.infoFiOracle,
            addrs.oracleAdapter,
            addrs.fpmmManager,
            addrs.sofToken,
            addrs.marketTypeRegistry,
            deployer,
            deployer
        );

        vm.stopBroadcast();

        addrs.infoFiFactory = address(factory);

        console2.log("InfoFiMarketFactory:", address(factory));

        return addrs;
    }
}
