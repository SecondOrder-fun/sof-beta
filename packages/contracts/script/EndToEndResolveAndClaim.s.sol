// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "forge-std/Vm.sol";

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {RaffleStorage} from "../src/core/RaffleStorage.sol";
import {VRFCoordinatorV2Mock} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";

contract EndToEndResolveAndClaim is Script {
    event SeasonEndRequested(uint256 indexed seasonId, uint256 indexed requestId);

    function run() external {
        // Read env
        uint256 adminPk = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");
        address sofAddr = vm.envAddress("SOF_ADDRESS");
        address vrfMockAddr = vm.envAddress("VRF_COORDINATOR_ADDRESS");
        address prizeDistributorAddr = vm.envAddress("PRIZE_DISTRIBUTOR_ADDRESS");

        address deployer = vm.addr(adminPk);

        require(raffleAddr != address(0), "RAFFLE_ADDRESS not set");
        require(sofAddr != address(0), "SOF_ADDRESS not set");
        require(vrfMockAddr != address(0), "VRF_COORDINATOR_ADDRESS not set");
        require(prizeDistributorAddr != address(0), "PRIZE_DISTRIBUTOR_ADDRESS not set");

        Raffle raffle = Raffle(raffleAddr);
        IERC20 sof = IERC20(sofAddr);
        VRFCoordinatorV2Mock vrf = VRFCoordinatorV2Mock(vrfMockAddr);
        RafflePrizeDistributor distributor = RafflePrizeDistributor(prizeDistributorAddr);

        // Determine season id
        uint256 seasonId = vm.envOr("SEASON_ID", uint256(1));
        console2.log("[E2E-Resolve] Target season:", seasonId);

        // Read season to get endTime and ensure active or endable
        RaffleTypes.SeasonConfig memory cfg;
        RaffleStorage.SeasonStatus status;
        (cfg, status,,,) = raffle.getSeasonDetails(seasonId);

        // 1) If not completed, request season end (or emergency end) and fulfill VRF
        if (status != RaffleStorage.SeasonStatus.Completed) {
            uint256 requestId;
            if (status == RaffleStorage.SeasonStatus.Active || status == RaffleStorage.SeasonStatus.NotStarted) {
                console2.log("[E2E-Resolve] Season is Active/NotStarted. Requesting end...");
                vm.startBroadcast(adminPk);
                vm.recordLogs();
                raffle.requestSeasonEndEarly(seasonId);
                vm.stopBroadcast();

                Vm.Log[] memory entries = vm.getRecordedLogs();
                requestId = _extractRequestIdFromLogs(entries);
            } else if (
                status == RaffleStorage.SeasonStatus.VRFPending || status == RaffleStorage.SeasonStatus.EndRequested
            ) {
                console2.log(
                    "[E2E-Resolve] Season is already VRFPending/EndRequested. Retrieving existing requestId..."
                );
                requestId = raffle.getVrfRequestForSeason(seasonId);
            } else {
                revert("Invalid season status for resolution");
            }

            require(requestId != 0, "Failed to find VRF requestId");
            console2.log("[E2E-Resolve] VRF requestId:", requestId);

            // 2) Fulfill VRF on mock, targeting the raffle contract
            vm.startBroadcast(adminPk);
            vrf.fulfillRandomWords(requestId, address(raffle));
            vm.stopBroadcast();
            console2.log("[E2E-Resolve] VRF fulfilled");

            // Confirm season has transitioned to Completed
            (, status,,,) = raffle.getSeasonDetails(seasonId);
            require(status == RaffleStorage.SeasonStatus.Completed, "Season not completed after VRF");
        } else {
            console2.log("[E2E-Resolve] Season already completed; skipping VRF step");
        }

        // After fulfillment, winners are available
        address[] memory winners = raffle.getWinners(seasonId);
        console2.log("[E2E-Resolve] Winners count:", winners.length);

        // 3) Claim grand prize from the raffle
        bool deployerIsWinner = _isWinner(winners, deployer);
        if (deployerIsWinner) {
            vm.startBroadcast(adminPk);
            uint256 balBeforeGrand = sof.balanceOf(deployer);
            distributor.claimGrand(seasonId);
            uint256 balAfterGrand = sof.balanceOf(deployer);
            vm.stopBroadcast();
            console2.log("[E2E-Resolve] Deployer claimed grand prize. +SOF:", balAfterGrand - balBeforeGrand);
        } else {
            console2.log("[E2E-Resolve] Deployer was not the winner. Claiming consolation...");

            // Claim consolation prize
            vm.startBroadcast(adminPk);
            uint256 balBeforeConsolation = sof.balanceOf(deployer);
            distributor.claimConsolation(seasonId);
            uint256 balAfterConsolation = sof.balanceOf(deployer);
            vm.stopBroadcast();
            console2.log(
                "[E2E-Resolve] Deployer claimed consolation prize. +SOF:", balAfterConsolation - balBeforeConsolation
            );
        }

        console2.log("[E2E-Resolve] Flow complete: season ended, VRF fulfilled, payouts claimed.");
    }

    function _extractRequestIdFromLogs(Vm.Log[] memory entries) internal pure returns (uint256) {
        bytes32 topicSeasonEndRequested = 0x656e5c80604277a61c82dbec54c99e9c266e8e019c6c1367d5b82e773fd395c7;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == topicSeasonEndRequested) {
                if (entries[i].data.length == 32) {
                    return abi.decode(entries[i].data, (uint256));
                }
                if (entries[i].topics.length >= 3) {
                    return uint256(entries[i].topics[2]);
                }
            }
        }

        bytes32 topicVRFRequested = 0x63373d1c4696214b898952999c9aaec57dac1ee2723cec59bea6888f489a9772;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == topicVRFRequested) {
                if (entries[i].data.length >= 32) {
                    bytes memory d = entries[i].data;
                    uint256 reqId;
                    assembly {
                        reqId := mload(add(d, 32))
                    }
                    if (reqId != 0) {
                        return reqId;
                    }
                }
            }
        }

        return 0;
    }

    function _isWinner(address[] memory winners, address target) internal pure returns (bool) {
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == target) return true;
        }
        return false;
    }
}
