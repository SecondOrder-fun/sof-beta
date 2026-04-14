// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {MarketTypeRegistry} from "../../src/infofi/MarketTypeRegistry.sol";

contract DeployMarketTypeRegistry is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        MarketTypeRegistry registry = new MarketTypeRegistry(deployer);

        vm.stopBroadcast();

        addrs.marketTypeRegistry = address(registry);

        console2.log("MarketTypeRegistry:", address(registry));

        return addrs;
    }
}
