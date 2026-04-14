// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {InfoFiPriceOracle} from "../../src/infofi/InfoFiPriceOracle.sol";

contract DeployInfoFiOracle is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        InfoFiPriceOracle oracle = new InfoFiPriceOracle(deployer, 7000, 3000);

        vm.stopBroadcast();

        addrs.infoFiOracle = address(oracle);

        console2.log("InfoFiPriceOracle:", address(oracle));

        return addrs;
    }
}
