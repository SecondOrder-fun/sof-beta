// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Raffle} from "../../src/core/Raffle.sol";
import {RaffleTypes} from "../../src/lib/RaffleTypes.sol";

/// @notice Test-B helper: create a short-lived season on the local Raffle contract.
/// @dev Env: RAFFLE, TREASURY, SEASON_NAME, DURATION_SECS, PRIVATE_KEY.
contract CreateSeason is Script {
    function run() external {
        address raffleAddr = vm.envAddress("RAFFLE");
        address treasury = vm.envAddress("TREASURY");
        string memory name = vm.envString("SEASON_NAME");
        uint256 duration = vm.envUint("DURATION_SECS");
        uint256 pk = vm.envUint("PRIVATE_KEY");

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: uint128(10_000), price: uint128(1 ether)});

        uint256 startTime = vm.envUint("START_TIME");
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = name;
        cfg.startTime = startTime;
        cfg.endTime = startTime + duration;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500; // 65% grand, 35% consolation
        cfg.treasuryAddress = treasury;

        vm.startBroadcast(pk);
        uint256 seasonId = Raffle(raffleAddr).createSeason(cfg, steps, 0, 0);
        vm.stopBroadcast();

        console2.log("seasonId", seasonId);
    }
}
