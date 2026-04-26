// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {VRFCoordinatorV2_5Mock} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

/**
 * Deploys the V2.5 VRF mock ONLY. Subscription creation + funding + consumer
 * registration happen post-deploy via cast (see scripts/local-dev.sh) to avoid
 * a `forge script --broadcast` gotcha: V2_5Mock.createSubscription() derives
 * its subId from `blockhash(block.number - 1)`, which differs between forge's
 * simulation pass and its broadcast pass. The simulated subId gets encoded
 * into fundSubscription's calldata and reverts with InvalidSubscription() on
 * the real chain.
 */
contract DeployVRFMock is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        require(block.chainid == 31337, "VRFMock: local only");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // V2Plus mock: (baseFee, gasPrice, weiPerUnitLink)
        VRFCoordinatorV2_5Mock vrf = new VRFCoordinatorV2_5Mock(1e17, 1e9, 4e15);

        vm.stopBroadcast();

        addrs.vrfCoordinator = address(vrf);
        addrs.vrfSubscriptionId = 0; // set post-deploy via cast
        addrs.vrfKeyHash = bytes32(uint256(1));

        console2.log("VRFCoordinatorV2_5Mock:", address(vrf));
        console2.log("VRF subscription: deferred to post-deploy (local-dev.sh)");

        return addrs;
    }
}
