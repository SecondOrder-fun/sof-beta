// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {Raffle} from "../../src/core/Raffle.sol";
import {VRFCoordinatorV2Mock} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";

contract DeployRaffle is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        Raffle raffle = new Raffle(
            addrs.sofToken,
            addrs.vrfCoordinator,
            addrs.vrfSubscriptionId,
            addrs.vrfKeyHash
        );

        // On local: add raffle as VRF consumer
        if (block.chainid == 31337) {
            VRFCoordinatorV2Mock(addrs.vrfCoordinator).addConsumer(
                uint64(addrs.vrfSubscriptionId),
                address(raffle)
            );
        }

        vm.stopBroadcast();

        addrs.raffle = address(raffle);

        console2.log("Raffle:", address(raffle));

        return addrs;
    }
}
