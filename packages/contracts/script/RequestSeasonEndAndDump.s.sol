// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "forge-std/Vm.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {RaffleStorage} from "../src/core/RaffleStorage.sol";

contract RequestSeasonEndAndDump is Script {
    function run() external {
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 seasonId = vm.envOr("SEASON_ID", uint256(1));

        Raffle raffle = Raffle(raffleAddr);
        (RaffleTypes.SeasonConfig memory cfg,,,,) = raffle.getSeasonDetails(seasonId);

        vm.startBroadcast(pk);
        if (block.timestamp < cfg.endTime + 1) {
            vm.warp(cfg.endTime + 1);
        }
        vm.recordLogs();
        raffle.requestSeasonEnd(seasonId);
        vm.stopBroadcast();

        Vm.Log[] memory entries = vm.getRecordedLogs();
        console2.log("[Dump] Logs count:", entries.length);
        for (uint256 i = 0; i < entries.length; i++) {
            console2.log("[Dump] log", i, "addr:", entries[i].emitter);
            console2.logBytes(entries[i].data);
            for (uint256 t = 0; t < entries[i].topics.length; t++) {
                console2.logBytes32(entries[i].topics[t]);
            }
        }
    }
}
