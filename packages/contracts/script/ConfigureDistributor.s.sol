// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/core/Raffle.sol";
import "../src/core/RafflePrizeDistributor.sol";
import "../src/lib/RaffleTypes.sol";
import "../src/core/RaffleStorage.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract ConfigureDistributor is Script {
    function run() external {
        // Read env
        uint256 adminPk = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");
        address distributorAddr = vm.envAddress("PRIZE_DISTRIBUTOR_ADDRESS");

        // Determine season id
        uint256 seasonId = vm.envOr("SEASON_ID", uint256(4));
        console2.log("Configuring distributor for season:", seasonId);

        Raffle raffle = Raffle(raffleAddr);
        RafflePrizeDistributor distributor = RafflePrizeDistributor(distributorAddr);

        // Get season details to configure distributor
        RaffleTypes.SeasonConfig memory config;
        RaffleStorage.SeasonStatus status;
        uint256 totalTickets;
        address winner;
        bytes32 merkleRoot;

        // Get season details - check the actual return types
        try raffle.getSeasonDetails(seasonId) returns (
            RaffleTypes.SeasonConfig memory _config,
            RaffleStorage.SeasonStatus _status,
            uint256, /* _totalParticipants */
            uint256 _totalTickets,
            uint256 /* _totalPrizePool */
        ) {
            config = _config;
            status = _status;
            totalTickets = _totalTickets;

            // Get winner from getWinners function
            try raffle.getWinners(seasonId) returns (address[] memory winners) {
                if (winners.length > 0) {
                    winner = winners[0];
                } else {
                    winner = address(0);
                }
            } catch {
                winner = address(0);
            }

            // Initialize merkleRoot
            merkleRoot = bytes32(0);
        } catch {
            revert("Failed to get season details");
        }

        console2.log("Season details:");
        console2.log("- Status:", uint8(status));
        console2.log("- Total tickets:", totalTickets);
        console2.log("- Winner:", winner);

        // Check if season is completed
        require(status == RaffleStorage.SeasonStatus.Completed, "Season must be completed to configure distributor");
        require(winner != address(0), "Winner must be set");

        // Start broadcast
        vm.startBroadcast(adminPk);

        // Fund distributor with SOF tokens (if needed)
        address sofAddr = vm.envAddress("SOF_ADDRESS");
        IERC20 sof = IERC20(sofAddr);

        // Check if distributor has enough SOF
        uint256 distributorBalance = sof.balanceOf(address(distributor));
        console2.log("Distributor SOF balance:", distributorBalance);

        // Fund the prize distributor for this season
        try raffle.fundPrizeDistributor(seasonId) {
            console2.log("Successfully funded prize distributor for season", seasonId);
        } catch Error(string memory reason) {
            console2.log("Failed to fund prize distributor:", reason);
        }

        vm.stopBroadcast();
    }
}
