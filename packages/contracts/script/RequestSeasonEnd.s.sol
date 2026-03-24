// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/core/Raffle.sol";
import "../src/lib/RaffleTypes.sol";

contract RequestSeasonEnd is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");
        uint256 seasonId = vm.envUint("SEASON_ID");

        Raffle raffle = Raffle(raffleAddr);
        (RaffleTypes.SeasonConfig memory cfg,,,,) = raffle.getSeasonDetails(seasonId);

        vm.startBroadcast(deployerPrivateKey);

        // Advance time to the season's end before requesting it
        if (block.timestamp < cfg.endTime) {
            vm.warp(cfg.endTime + 1);
        }

        raffle.requestSeasonEnd(seasonId);

        vm.stopBroadcast();
    }
}
