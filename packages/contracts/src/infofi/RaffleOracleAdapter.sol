// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IConditionalTokens.sol";
import "openzeppelin-contracts/contracts/access/AccessControl.sol";

/**
 * @title RaffleOracleAdapter
 * @notice Bridges Raffle VRF resolution to Gnosis Conditional Token Framework
 * @dev Replaces UMA oracle - uses raffle winner as resolution source
 *
 * Architecture:
 * - Prepares binary conditions for each player: [WIN, LOSE]
 * - Resolves conditions after raffle VRF determines winner
 * - Supports batch resolution for gas efficiency
 * - Only authorized resolvers (InfoFiMarketFactory) can prepare/resolve
 */
contract RaffleOracleAdapter is AccessControl {
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    IConditionalTokens public immutable conditionalTokens;

    /// @notice Maps seasonId => player => conditionId
    mapping(uint256 => mapping(address => bytes32)) public playerConditions;

    /// @notice Tracks resolved conditions to prevent double resolution
    mapping(bytes32 => bool) public resolved;

    /// @notice Emitted when a player condition is prepared
    event ConditionPrepared(
        uint256 indexed seasonId, address indexed player, bytes32 indexed conditionId, bytes32 questionId
    );

    /// @notice Emitted when a condition is resolved
    event ConditionResolved(
        bytes32 indexed conditionId, uint256 indexed seasonId, address indexed player, bool playerWon, uint256[] payouts
    );

    error ConditionAlreadyPrepared();
    error ConditionNotPrepared();
    error ConditionAlreadyResolved();
    error InvalidOutcomeSlotCount();

    /**
     * @notice Initialize the oracle adapter
     * @param _conditionalTokens Address of Gnosis ConditionalTokens contract
     * @param _admin Address to grant admin and resolver roles
     */
    constructor(address _conditionalTokens, address _admin) {
        require(_conditionalTokens != address(0), "CTF zero address");
        require(_admin != address(0), "Admin zero address");

        conditionalTokens = IConditionalTokens(_conditionalTokens);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RESOLVER_ROLE, _admin);
    }

    /**
     * @notice Prepare condition for player winning season
     * @param seasonId Raffle season ID
     * @param player Player address
     * @return conditionId The prepared condition ID
     *
     * @dev Creates binary outcome condition: [WIN, LOSE]
     *      Question ID combines season and player for uniqueness
     *      Only callable by authorized resolvers (InfoFiMarketFactory)
     */
    function preparePlayerCondition(uint256 seasonId, address player)
        external
        onlyRole(RESOLVER_ROLE)
        returns (bytes32 conditionId)
    {
        require(player != address(0), "Player zero address");

        // Check if already prepared
        if (playerConditions[seasonId][player] != bytes32(0)) {
            revert ConditionAlreadyPrepared();
        }

        // Question ID combines season and player for uniqueness
        bytes32 questionId = keccak256(abi.encodePacked(seasonId, player));

        // Binary outcome: [WIN, LOSE]
        uint256 outcomeSlotCount = 2;

        // Prepare condition with this contract as oracle
        conditionalTokens.prepareCondition(address(this), questionId, outcomeSlotCount);

        // Calculate condition ID
        conditionId = conditionalTokens.getConditionId(address(this), questionId, outcomeSlotCount);

        // Store mapping
        playerConditions[seasonId][player] = conditionId;

        emit ConditionPrepared(seasonId, player, conditionId, questionId);
    }

    /**
     * @notice Resolve condition after raffle ends
     * @param seasonId Raffle season ID
     * @param player Player address
     * @param playerWon True if player won the raffle
     *
     * @dev Sets payout vector: [1, 0] if player won, [0, 1] if player lost
     *      Only callable by authorized resolvers (InfoFiMarketFactory)
     */
    function resolvePlayerCondition(uint256 seasonId, address player, bool playerWon)
        external
        onlyRole(RESOLVER_ROLE)
    {
        bytes32 conditionId = playerConditions[seasonId][player];

        if (conditionId == bytes32(0)) {
            revert ConditionNotPrepared();
        }

        if (resolved[conditionId]) {
            revert ConditionAlreadyResolved();
        }

        // Payout vector: [WIN, LOSE]
        uint256[] memory payouts = new uint256[](2);
        if (playerWon) {
            payouts[0] = 1; // WIN gets 1
            payouts[1] = 0; // LOSE gets 0
        } else {
            payouts[0] = 0; // WIN gets 0
            payouts[1] = 1; // LOSE gets 1
        }

        // Report payouts to CTF
        bytes32 questionId = keccak256(abi.encodePacked(seasonId, player));
        conditionalTokens.reportPayouts(questionId, payouts);

        // Mark as resolved
        resolved[conditionId] = true;

        emit ConditionResolved(conditionId, seasonId, player, playerWon, payouts);
    }

    /**
     * @notice Batch resolve all players in a season
     * @param seasonId Raffle season ID
     * @param players Array of player addresses
     * @param winner Address of the winning player
     *
     * @dev Gas-efficient batch resolution after VRF determines winner
     *      Resolves all markets in single transaction
     *      Only callable by authorized resolvers (InfoFiMarketFactory)
     */
    function batchResolveSeasonMarkets(uint256 seasonId, address[] calldata players, address winner)
        external
        onlyRole(RESOLVER_ROLE)
    {
        require(winner != address(0), "Winner zero address");
        require(players.length > 0, "Empty players array");

        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];

            // Skip if not prepared
            bytes32 conditionId = playerConditions[seasonId][player];
            if (conditionId == bytes32(0)) continue;

            // Skip if already resolved
            if (resolved[conditionId]) continue;

            // Determine outcome
            bool playerWon = (player == winner);

            // Payout vector
            uint256[] memory payouts = new uint256[](2);
            if (playerWon) {
                payouts[0] = 1;
                payouts[1] = 0;
            } else {
                payouts[0] = 0;
                payouts[1] = 1;
            }

            // Report payouts
            bytes32 questionId = keccak256(abi.encodePacked(seasonId, player));
            conditionalTokens.reportPayouts(questionId, payouts);

            // Mark as resolved
            resolved[conditionId] = true;

            emit ConditionResolved(conditionId, seasonId, player, playerWon, payouts);
        }
    }

    /**
     * @notice Get condition ID for a player in a season
     * @param seasonId Raffle season ID
     * @param player Player address
     * @return conditionId The condition ID (bytes32(0) if not prepared)
     */
    function getPlayerConditionId(uint256 seasonId, address player) external view returns (bytes32) {
        return playerConditions[seasonId][player];
    }

    /**
     * @notice Check if a condition is resolved
     * @param conditionId The condition ID
     * @return bool True if resolved
     */
    function isResolved(bytes32 conditionId) external view returns (bool) {
        return resolved[conditionId];
    }

    /**
     * @notice Get question ID for a player in a season
     * @param seasonId Raffle season ID
     * @param player Player address
     * @return questionId The question ID
     */
    function getQuestionId(uint256 seasonId, address player) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(seasonId, player));
    }
}
