// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ISeasonGating
/// @notice Interface for season participation requirements (gating)
/// @dev Allows configuring gates that users must pass before participating in raffles
interface ISeasonGating {
    /// @notice Types of gates that can be configured
    enum GateType {
        NONE,       // 0 - No gate (placeholder)
        PASSWORD,   // 1 - Simple password verification
        ALLOWLIST,  // 2 - Merkle proof allowlist (future)
        TOKEN_GATE, // 3 - Minimum token balance (future)
        SIGNATURE   // 4 - Off-chain signature (future)
    }

    /// @notice Configuration for a single gate
    /// @param gateType The type of gate
    /// @param enabled Whether the gate is active
    /// @param configHash Interpretation depends on gateType:
    ///        - PASSWORD: keccak256(abi.encodePacked(password))
    ///        - ALLOWLIST: merkleRoot
    ///        - TOKEN_GATE: keccak256(abi.encode(tokenAddress, minBalance))
    ///        - SIGNATURE: trusted signer address (as bytes32)
    struct GateConfig {
        GateType gateType;
        bool enabled;
        bytes32 configHash;
    }

    // ============ Events ============

    /// @notice Emitted when gates are configured for a season
    event GatesConfigured(uint256 indexed seasonId, uint256 gateCount);

    /// @notice Emitted when a user passes a gate verification
    event UserVerified(
        uint256 indexed seasonId,
        uint256 indexed gateIndex,
        address indexed user,
        GateType gateType
    );

    /// @notice Emitted when a gate is added to a season
    event GateAdded(uint256 indexed seasonId, uint256 gateIndex, GateType gateType);

    /// @notice Emitted when a gate is removed from a season
    event GateRemoved(uint256 indexed seasonId, uint256 gateIndex);

    // ============ Errors ============

    /// @notice Season ID is invalid (0 or non-existent)
    error InvalidSeasonId();

    /// @notice Gate is not enabled
    error GateNotEnabled();

    /// @notice Gate index is out of bounds
    error InvalidGateIndex();

    /// @notice Password does not match stored hash
    error InvalidPassword();

    /// @notice User has already verified for this gate
    error AlreadyVerified();

    /// @notice Gate type does not match expected type for operation
    error GateTypeMismatch();

    /// @notice Password cannot be empty
    error EmptyPassword();

    /// @notice Caller is not authorized for this operation
    error Unauthorized();

    /// @notice No gates configured for this season
    error NoGatesConfigured();

    /// @notice Signature has expired
    error SignatureExpired();

    /// @notice Recovered signer does not match expected signer
    error InvalidSignature();

    // ============ Admin Functions ============

    /// @notice Configure gates for a season (called by admin/Raffle)
    /// @dev All gates use AND logic - user must pass ALL gates
    /// @param seasonId The season to configure
    /// @param gates Array of gate configurations
    function configureGates(uint256 seasonId, GateConfig[] calldata gates) external;

    /// @notice Remove all gates from a season
    /// @param seasonId The season to clear gates from
    function clearGates(uint256 seasonId) external;

    // ============ View Functions ============

    /// @notice Check if user has passed all gates for a season
    /// @param seasonId The season to check
    /// @param user The user address
    /// @return verified True if user has passed all required gates
    function isUserVerified(uint256 seasonId, address user) external view returns (bool);

    /// @notice Get gate configuration for a season
    /// @param seasonId The season
    /// @return gates Array of gate configs
    function getSeasonGates(uint256 seasonId) external view returns (GateConfig[] memory);

    /// @notice Check verification status for specific gate
    /// @param seasonId The season
    /// @param gateIndex The gate index
    /// @param user The user address
    /// @return verified True if this specific gate is passed
    function isGateVerified(
        uint256 seasonId,
        uint256 gateIndex,
        address user
    ) external view returns (bool);

    /// @notice Get the number of gates for a season
    /// @param seasonId The season
    /// @return count Number of gates configured
    function getGateCount(uint256 seasonId) external view returns (uint256);

    // ============ User Verification Functions ============

    /// @notice Submit password to verify for PASSWORD gate
    /// @param seasonId The season
    /// @param gateIndex Which gate in the array
    /// @param password The plaintext password
    function verifyPassword(
        uint256 seasonId,
        uint256 gateIndex,
        string calldata password
    ) external;

    /// @notice Submit EIP-712 signature to verify for SIGNATURE gate
    /// @param seasonId The season
    /// @param gateIndex Which gate in the array
    /// @param deadline Signature expiration timestamp
    /// @param v ECDSA recovery id
    /// @param r ECDSA signature component
    /// @param s ECDSA signature component
    function verifySignature(
        uint256 seasonId,
        uint256 gateIndex,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
