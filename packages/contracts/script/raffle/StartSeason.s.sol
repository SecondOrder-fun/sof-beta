// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {Raffle} from "src/core/Raffle.sol";
import {RaffleTypes} from "src/lib/RaffleTypes.sol";
import "src/core/RaffleStorage.sol";

contract StartSeasonScript is Script {
    function run() external {
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS_LOCAL");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address caller = vm.addr(pk);

        // Default to season 1 unless overridden by setting SEASON_ID in env
        uint256 seasonId = 1;
        try vm.envUint("SEASON_ID") returns (uint256 envSeasonId) {
            seasonId = envSeasonId;
        } catch {
            console2.log("SEASON_ID not set, defaulting to season 1");
        }

        console2.log("=== START SEASON DEBUG ===");
        console2.log("Raffle address:", raffleAddr);
        console2.log("Season ID:", seasonId);
        console2.log("Caller address:", caller);

        Raffle raffle = Raffle(raffleAddr);

        // Check caller permissions up front
        bytes32 seasonCreatorRole = raffle.SEASON_CREATOR_ROLE();
        bool hasRole = raffle.hasRole(seasonCreatorRole, caller);
        console2.log("Caller has SEASON_CREATOR_ROLE:", hasRole);
        if (!hasRole) {
            console2.log("ERROR: Caller lacks SEASON_CREATOR_ROLE");
            revert("Missing SEASON_CREATOR_ROLE");
        }

        // Check if season exists and get config/state details
        RaffleTypes.SeasonConfig memory cfg;
        RaffleStorage.SeasonStatus seasonStatus;
        try raffle.getSeasonDetails(seasonId) returns (
            RaffleTypes.SeasonConfig memory config,
            RaffleStorage.SeasonStatus fetchedStatus,
            uint256 totalParticipants,
            uint256 totalTickets,
            uint256 totalPrizePool
        ) {
            cfg = config;
            seasonStatus = fetchedStatus;
            console2.log("Season exists");
            console2.log("Total participants:", totalParticipants);
            console2.log("Total tickets:", totalTickets);
            console2.log("Recorded prize pool:", totalPrizePool);
        } catch {
            console2.log("ERROR: Season", seasonId, "does not exist or cannot be accessed");
            revert("Season not found");
        }

        console2.log("Season name:", cfg.name);
        console2.log("Season start time:", cfg.startTime);
        console2.log("Season end time:", cfg.endTime);
        console2.log("Current timestamp:", block.timestamp);
        console2.log("Season status enum value:", uint256(seasonStatus));

        if (seasonStatus != RaffleStorage.SeasonStatus.NotStarted) {
            console2.log("ERROR: Season status must be NotStarted to call startSeason");
            revert("Season already started or ended");
        }

        if (cfg.isActive) {
            console2.log("ERROR: Season already marked active");
            revert("Season already active");
        }

        if (block.timestamp < cfg.startTime) {
            console2.log("ERROR: Current block timestamp is before season start time");
            console2.log("You must wait until the on-chain timestamp reaches startTime before running this script.");
            revert("Season start time not reached");
        }

        if (block.timestamp >= cfg.endTime) {
            console2.log("ERROR: Season end time has passed  cannot start season");
            revert("Season already expired");
        }

        vm.startBroadcast(pk);
        raffle.startSeason(seasonId);
        vm.stopBroadcast();

        console2.log("Season started successfully:", seasonId);
    }
}
