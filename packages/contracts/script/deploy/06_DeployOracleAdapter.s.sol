// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {RaffleOracleAdapter} from "../../src/infofi/RaffleOracleAdapter.sol";

contract DeployOracleAdapter is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        RaffleOracleAdapter adapter = new RaffleOracleAdapter(addrs.conditionalTokens, deployer);

        vm.stopBroadcast();

        addrs.oracleAdapter = address(adapter);

        console2.log("RaffleOracleAdapter:", address(adapter));

        return addrs;
    }
}
