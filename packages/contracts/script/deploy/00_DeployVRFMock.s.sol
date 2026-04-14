// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {VRFCoordinatorV2Mock} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";

contract DeployVRFMock is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        require(block.chainid == 31337, "VRFMock: local only");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        VRFCoordinatorV2Mock vrf = new VRFCoordinatorV2Mock(1e17, 1e9);
        uint64 subId = vrf.createSubscription();
        vrf.fundSubscription(subId, 100 ether);

        vm.stopBroadcast();

        addrs.vrfCoordinator = address(vrf);
        addrs.vrfSubscriptionId = uint256(subId);
        addrs.vrfKeyHash = bytes32(uint256(1));

        console2.log("VRFCoordinatorV2Mock:", address(vrf));
        console2.log("VRF SubscriptionId:", uint256(subId));

        return addrs;
    }
}
