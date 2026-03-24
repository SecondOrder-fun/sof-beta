// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {Raffle} from "../src/core/Raffle.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {VRFCoordinatorV2Mock} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";

/**
 * @title FulfillVRFOverride
 * @notice Local-only helper to read vrfRequestId for a season and call the VRF mock's
 *         fulfillRandomWordsWithOverride with a deterministic words array.
 *
 * Required env vars (inline):
 * - PRIVATE_KEY
 * - RAFFLE_ADDRESS
 * - VRF_COORDINATOR_ADDRESS
 * - SEASON_ID
 */
contract FulfillVRFOverride is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");
        address vrfAddr = vm.envAddress("VRF_COORDINATOR_ADDRESS");
        uint256 seasonId = vm.envUint("SEASON_ID");

        require(raffleAddr != address(0), "RAFFLE_ADDRESS not set");
        require(vrfAddr != address(0), "VRF_COORDINATOR_ADDRESS not set");
        require(seasonId > 0, "SEASON_ID must be > 0");

        vm.startBroadcast(pk);

        Raffle raffle = Raffle(raffleAddr);
        VRFCoordinatorV2Mock vrf = VRFCoordinatorV2Mock(vrfAddr);

        // Pull season details to know winnerCount (array length required)
        (RaffleTypes.SeasonConfig memory cfg,,,,) = raffle.getSeasonDetails(seasonId);

        // Read vrfRequestId directly from the mapping
        uint256 vrfRequestId = raffle.vrfRequestToSeason(seasonId);

        require(vrfRequestId != 0, "vrfRequestId is zero (call requestSeasonEnd first)");
        console2.log("Season:", seasonId, "vrfRequestId:", vrfRequestId);
        console2.log("WinnerCount:", cfg.winnerCount);

        // Build words array with deterministic values [1,2,3,...]
        uint256 wc = cfg.winnerCount;
        if (wc == 0) {
            wc = 1; // safety
        }
        uint256[] memory words = new uint256[](wc);
        for (uint256 i = 0; i < wc; i++) {
            words[i] = i + 1;
        }

        // Fulfill with override
        vrf.fulfillRandomWordsWithOverride(vrfRequestId, raffleAddr, words);
        console2.log("VRF override fulfilled.");

        vm.stopBroadcast();
    }
}
