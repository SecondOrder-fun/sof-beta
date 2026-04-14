// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {RafflePrizeDistributor} from "../../src/core/RafflePrizeDistributor.sol";

contract DeployDistributor is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        RafflePrizeDistributor distributor = new RafflePrizeDistributor(deployer);

        vm.stopBroadcast();

        addrs.prizeDistributor = address(distributor);

        console2.log("RafflePrizeDistributor:", address(distributor));

        return addrs;
    }
}
