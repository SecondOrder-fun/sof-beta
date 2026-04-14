// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SeasonFactory} from "../../src/core/SeasonFactory.sol";

contract DeploySeasonFactory is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        SeasonFactory factory = new SeasonFactory(addrs.raffle);

        vm.stopBroadcast();

        addrs.seasonFactory = address(factory);

        console2.log("SeasonFactory:", address(factory));

        return addrs;
    }
}
