// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RaffleStorage} from "../core/RaffleStorage.sol";

/**
 * @title RaffleLogic Library
 * @notice Contains internal helper functions for the Raffle contract to reduce its size.
 */
library RaffleLogic {
    /// @notice Maximum retry attempts for hash-and-extend deduplication per winner slot
    uint256 internal constant MAX_RETRIES = 20;

    function _selectWinnersAddressBased(
        RaffleStorage.SeasonState storage state,
        uint16 winnerCount,
        uint256[] memory randomWords
    ) internal view returns (address[] memory) {
        if (state.totalTickets == 0 || state.participants.length == 0 || winnerCount == 0) {
            return new address[](0);
        }

        // Special case: if there's only one participant, they must be the winner
        if (state.participants.length == 1) {
            address[] memory singleWinner = new address[](1);
            singleWinner[0] = state.participants[0];
            return singleWinner;
        }

        // Build cumulative ticket prefix sums for binary search
        uint256 pLen = state.participants.length;
        uint256[] memory prefixSums = new uint256[](pLen);
        uint256 cumulative = 0;
        for (uint256 i = 0; i < pLen; i++) {
            cumulative += state.participantPositions[state.participants[i]].ticketCount;
            prefixSums[i] = cumulative;
        }

        // Cannot select more unique winners than there are participants
        uint256 maxWinners = winnerCount > pLen ? pLen : winnerCount;

        address[] memory temp = new address[](maxWinners);
        bool[] memory picked = new bool[](pLen);
        uint256 selected = 0;

        for (uint256 i = 0; i < maxWinners; i++) {
            uint256 rand = randomWords[i % randomWords.length];
            // Hash-and-extend: if the initial word collides with an already-picked
            // participant, derive a new pseudo-random value and retry
            uint256 nonce = 0;
            for (uint256 r = 0; r <= MAX_RETRIES; r++) {
                uint256 ticketNumber = (rand % state.totalTickets) + 1;
                uint256 idx = _findParticipantByTicketBinarySearch(prefixSums, ticketNumber);
                if (idx < pLen && !picked[idx]) {
                    temp[selected] = state.participants[idx];
                    picked[idx] = true;
                    selected++;
                    break;
                }
                // Derive a new random value from the original word + nonce
                nonce++;
                rand = uint256(keccak256(abi.encode(randomWords[i % randomWords.length], nonce)));
            }
        }

        address[] memory winners = new address[](selected);
        for (uint256 k = 0; k < selected; k++) {
            winners[k] = temp[k];
        }
        return winners;
    }

    /// @notice Binary search on cumulative prefix sums to find participant index for a ticket number
    /// @param prefixSums Cumulative ticket counts (1-indexed ticket space)
    /// @param ticketNumber The ticket to look up (1-based)
    /// @return idx The index into the participants array
    function _findParticipantByTicketBinarySearch(uint256[] memory prefixSums, uint256 ticketNumber)
        internal
        pure
        returns (uint256 idx)
    {
        // ticketNumber is 1-based; prefixSums[i] = cumulative tickets through participant i
        // Participant i owns tickets (prefixSums[i-1]+1 .. prefixSums[i])
        // We need the smallest i where prefixSums[i] >= ticketNumber
        uint256 lo = 0;
        uint256 hi = prefixSums.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (prefixSums[mid] < ticketNumber) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
}
