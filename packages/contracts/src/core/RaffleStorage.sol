// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RaffleStorage
 * @notice Holds all storage variables, structs, and events for the Raffle contract.
 * @dev Separating storage into a base contract is a pattern to avoid contract size limits.
 */
import "../lib/RaffleTypes.sol";

abstract contract RaffleStorage {
    // Roles
    bytes32 public constant SEASON_CREATOR_ROLE = keccak256("SEASON_CREATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant BONDING_CURVE_ROLE = keccak256("BONDING_CURVE_ROLE");

    enum SeasonStatus {
        NotStarted,
        Active,
        EndRequested,
        VRFPending,
        Distributing,
        Completed,
        Cancelled
    }

    struct ParticipantPosition {
        uint256 ticketCount;
        uint256 entryBlock;
        uint256 lastUpdateBlock;
        bool isActive;
    }

    struct SeasonState {
        SeasonStatus status;
        uint256 totalParticipants;
        uint256 totalTickets;
        uint256 totalPrizePool;
        address[] winners;
        uint256 vrfRequestId;
        uint256 vrfRequestTimestamp;
        uint256[] vrfRandomWords;
        mapping(address => ParticipantPosition) participantPositions;
        address[] participants;
        bytes32 lockSnapshot;
    }

    // Storage
    uint256 public currentSeasonId;
    mapping(uint256 => RaffleTypes.SeasonConfig) public seasons;
    mapping(uint256 => SeasonState) public seasonStates;
    mapping(uint256 => uint256) public vrfRequestToSeason;

    // Gating contract for participation requirements
    address public gatingContract;

    // Events
    event SeasonCreated(
        uint256 indexed seasonId,
        string name,
        uint256 startTime,
        uint256 endTime,
        address raffleToken,
        address bondingCurve
    );
    event SeasonStarted(uint256 indexed seasonId);
    event SeasonLocked(uint256 indexed seasonId);
    event SeasonEndRequested(uint256 indexed seasonId, uint256 vrfRequestId);
    event WinnersSelected(uint256 indexed seasonId, address[] winners);
    event PrizeDistributionSetup(uint256 indexed seasonId, address merkleDistributor);
    event SeasonCompleted(uint256 indexed seasonId);
    event PrizeDistributionFailed(uint256 indexed seasonId, string reason);
    event ParticipantAdded(uint256 indexed seasonId, address participant, uint256 tickets, uint256 totalTickets);
    event ParticipantUpdated(uint256 indexed seasonId, address participant, uint256 newTickets, uint256 totalTickets);
    event ParticipantRemoved(uint256 indexed seasonId, address participant, uint256 totalTickets);

    // Auto-finalization events
    event VRFFulfilled(uint256 indexed seasonId, uint256 indexed requestId);
    event AutoFinalizeAttempted(uint256 indexed seasonId, bool success);
    event AutoFinalizeFailed(uint256 indexed seasonId, string reason);
    event AutoFinalizeFailedLowLevel(uint256 indexed seasonId, bytes data);

    // Season cancellation events
    event SeasonCancelled(uint256 indexed seasonId);

    // Audit snapshot event
    event SeasonSnapshotted(uint256 indexed seasonId, bytes32 snapshotHash);

    // Gating events
    event GatingContractUpdated(address indexed oldContract, address indexed newContract);
}
