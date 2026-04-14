// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {ConditionalTokenSOF} from "../../src/infofi/ConditionalTokenSOF.sol";

contract DeployConditionalTokens is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        ConditionalTokenSOF ct = new ConditionalTokenSOF();

        vm.stopBroadcast();

        addrs.conditionalTokens = address(ct);

        console2.log("ConditionalTokenSOF:", address(ct));

        return addrs;
    }
}
