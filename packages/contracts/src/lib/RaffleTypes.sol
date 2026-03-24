// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library RaffleTypes {
    struct SeasonConfig {
        string name;
        uint256 startTime;
        uint256 endTime;
        uint16 winnerCount;
        uint16 grandPrizeBps; // In basis points (e.g. 6500 = 65% of totalPrizePool to grand winner). 0 => use default in Raffle
        address treasuryAddress; // Where accumulated fees are sent (set by season creator)
        address raffleToken;
        address bondingCurve;
        address sponsor; // Season sponsor (creator in permissionless mode, or explicit sponsor)
        bool isActive;
        bool isCompleted;
        bool gated; // If true, users must pass gating requirements before buying tickets
    }

    struct BondStep {
        uint128 rangeTo; // Token supply level where this step ends
        uint128 price; // Price in $SOF per token for this step
    }
}
