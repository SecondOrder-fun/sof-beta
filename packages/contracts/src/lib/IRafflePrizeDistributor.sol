// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRafflePrizeDistributor {
    struct SeasonPayouts {
        address token;
        address grandWinner;
        uint256 grandAmount;
        uint256 consolationAmount;
        uint256 totalParticipants;
        bool funded;
        bool grandClaimed;
    }

    struct TierConfig {
        uint16 winnerCount;
    }

    event SeasonConfigured(
        uint256 indexed seasonId,
        address indexed token,
        address indexed grandWinner,
        uint256 grandAmount,
        uint256 consolationAmount,
        uint256 totalParticipants
    );

    event SeasonFunded(uint256 indexed seasonId, uint256 amount);
    event GrandClaimed(uint256 indexed seasonId, address indexed winner, uint256 amount);
    event ConsolationClaimed(uint256 indexed seasonId, address indexed account, uint256 amount);
    event ConsolationEligibilitySet(uint256 indexed seasonId, uint256 participantCount);

    event TiersConfigured(uint256 indexed seasonId, uint256 tierCount, uint256 totalWinners);
    event TierWinnersSet(uint256 indexed seasonId, uint256 tierCount);

    function configureSeason(
        uint256 seasonId,
        address token,
        address grandWinner,
        uint256 grandAmount,
        uint256 consolationAmount,
        uint256 totalParticipants
    ) external;

    function setConsolationEligible(uint256 seasonId, address[] calldata participants) external;

    function configureTiers(uint256 seasonId, TierConfig[] calldata tiers) external;

    function setTierWinners(uint256 seasonId, address[] calldata allWinners) external;

    function lockSponsorships(uint256 seasonId) external;

    function fundSeason(uint256 seasonId, uint256 amount) external;

    function claimGrand(uint256 seasonId) external;

    function claimConsolation(uint256 seasonId) external;

    function isConsolationClaimed(uint256 seasonId, address account) external view returns (bool);

    function isConsolationEligible(uint256 seasonId, address account) external view returns (bool);

    function getSeason(uint256 seasonId) external view returns (SeasonPayouts memory);

    function getTierConfigs(uint256 seasonId) external view returns (TierConfig[] memory);

    function getTierWinners(uint256 seasonId, uint256 tierIndex) external view returns (address[] memory);

    function getWinnerTier(uint256 seasonId, address winner) external view returns (bool isTierWinner, uint256 tierIndex);
}
