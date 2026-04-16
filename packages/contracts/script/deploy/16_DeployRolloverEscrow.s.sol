// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {RolloverEscrow} from "../../src/core/RolloverEscrow.sol";

contract DeployRolloverEscrow is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        RolloverEscrow escrow = new RolloverEscrow(
            addrs.sofToken,
            treasury,
            addrs.raffle
        );

        vm.stopBroadcast();

        addrs.rolloverEscrow = address(escrow);

        console2.log("RolloverEscrow:", address(escrow));

        return addrs;
    }
}
