// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFToken} from "../../src/token/SOFToken.sol";

contract DeploySOFToken is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        SOFToken sof = new SOFToken("SOF Token", "SOF", 100_000_000 ether);

        vm.stopBroadcast();

        addrs.sofToken = address(sof);

        console2.log("SOFToken:", address(sof));

        return addrs;
    }
}
