// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {Raffle} from "../../src/core/Raffle.sol";

contract DeployRaffle is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        Raffle raffle = new Raffle(
            addrs.sofToken,
            addrs.vrfCoordinator,
            addrs.vrfSubscriptionId,
            addrs.vrfKeyHash
        );

        vm.stopBroadcast();

        addrs.raffle = address(raffle);

        // VRF consumer registration happens in step 19 (AddVRFConsumer) on
        // testnet/mainnet, and post-deploy via cast in scripts/local-dev.sh
        // for the Anvil VRF mock path.
        console2.log("Raffle:", address(raffle));

        return addrs;
    }
}
