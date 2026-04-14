// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISeasonGating} from "./ISeasonGating.sol";
import {SeasonGatingStorage} from "./SeasonGatingStorage.sol";

/// @title SeasonGating
/// @notice Manages participation requirements (gates) for raffle seasons
/// @dev Uses AND logic - users must pass ALL configured gates to participate
contract SeasonGating is ISeasonGating, SeasonGatingStorage, AccessControl, ReentrancyGuard, EIP712 {
    // ============ Roles ============

    /// @notice Role for configuring gates (typically the Raffle contract)
    bytes32 public constant GATE_ADMIN_ROLE = keccak256("GATE_ADMIN_ROLE");

    bytes32 private constant SEASON_ALLOWLIST_TYPEHASH = keccak256(
        "SeasonAllowlist(uint256 seasonId,uint256 gateIndex,address participant,uint256 deadline)"
    );

    // ============ Constructor ============

    /// @notice Initializes the SeasonGating contract
    /// @param admin Address that will have admin and gate admin roles
    /// @param _raffleContract Address of the Raffle contract (if known at deploy time)
    constructor(address admin, address _raffleContract)
        EIP712("SecondOrder.fun SeasonGating", "1")
    {
        if (admin == address(0)) revert Unauthorized();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GATE_ADMIN_ROLE, admin);

        if (_raffleContract != address(0)) {
            _grantRole(GATE_ADMIN_ROLE, _raffleContract);
            raffleContract = _raffleContract;
        }
    }

    // ============ Admin Functions ============

    /// @notice Set the Raffle contract address and grant it GATE_ADMIN_ROLE
    /// @param _raffleContract The Raffle contract address
    function setRaffleContract(address _raffleContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Revoke role from old raffle contract if exists
        if (raffleContract != address(0)) {
            _revokeRole(GATE_ADMIN_ROLE, raffleContract);
        }

        raffleContract = _raffleContract;

        if (_raffleContract != address(0)) {
            _grantRole(GATE_ADMIN_ROLE, _raffleContract);
        }
    }

    /// @inheritdoc ISeasonGating
    function configureGates(
        uint256 seasonId,
        GateConfig[] calldata gates
    ) external override onlyRole(GATE_ADMIN_ROLE) {
        if (seasonId == 0) revert InvalidSeasonId();

        // Clear existing gates
        delete _seasonGates[seasonId];

        // Add new gates
        for (uint256 i = 0; i < gates.length; i++) {
            _seasonGates[seasonId].push(gates[i]);
            emit GateAdded(seasonId, i, gates[i].gateType);
        }

        emit GatesConfigured(seasonId, gates.length);
    }

    /// @inheritdoc ISeasonGating
    function clearGates(uint256 seasonId) external override onlyRole(GATE_ADMIN_ROLE) {
        if (seasonId == 0) revert InvalidSeasonId();

        uint256 gateCount = _seasonGates[seasonId].length;
        for (uint256 i = 0; i < gateCount; i++) {
            emit GateRemoved(seasonId, i);
        }

        delete _seasonGates[seasonId];
        emit GatesConfigured(seasonId, 0);
    }

    // ============ User Verification Functions ============

    /// @inheritdoc ISeasonGating
    function verifyPassword(
        uint256 seasonId,
        uint256 gateIndex,
        string calldata password
    ) external override nonReentrant {
        if (seasonId == 0) revert InvalidSeasonId();
        if (bytes(password).length == 0) revert EmptyPassword();

        GateConfig[] storage gates = _seasonGates[seasonId];
        if (gateIndex >= gates.length) revert InvalidGateIndex();

        GateConfig storage gate = gates[gateIndex];
        if (gate.gateType != GateType.PASSWORD) revert GateTypeMismatch();
        if (!gate.enabled) revert GateNotEnabled();
        if (_userVerified[seasonId][msg.sender][gateIndex]) revert AlreadyVerified();

        // Hash the input password and compare
        bytes32 inputHash = keccak256(abi.encodePacked(password));
        if (inputHash != gate.configHash) revert InvalidPassword();

        // Mark user as verified for this gate
        _userVerified[seasonId][msg.sender][gateIndex] = true;

        emit UserVerified(seasonId, gateIndex, msg.sender, GateType.PASSWORD);
    }

    /// @inheritdoc ISeasonGating
    function verifySignature(
        uint256 seasonId,
        uint256 gateIndex,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant {
        if (seasonId == 0) revert InvalidSeasonId();
        if (block.timestamp > deadline) revert SignatureExpired();

        GateConfig[] storage gates = _seasonGates[seasonId];
        if (gateIndex >= gates.length) revert InvalidGateIndex();

        GateConfig storage gate = gates[gateIndex];
        if (gate.gateType != GateType.SIGNATURE) revert GateTypeMismatch();
        if (!gate.enabled) revert GateNotEnabled();
        if (_userVerified[seasonId][msg.sender][gateIndex]) revert AlreadyVerified();

        bytes32 structHash = keccak256(abi.encode(
            SEASON_ALLOWLIST_TYPEHASH,
            seasonId,
            gateIndex,
            msg.sender,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, v, r, s);

        if (recoveredSigner != address(uint160(uint256(gate.configHash)))) revert InvalidSignature();

        _userVerified[seasonId][msg.sender][gateIndex] = true;
        emit UserVerified(seasonId, gateIndex, msg.sender, GateType.SIGNATURE);
    }

    // ============ View Functions ============

    /// @inheritdoc ISeasonGating
    function isUserVerified(uint256 seasonId, address user) external view override returns (bool) {
        GateConfig[] storage gates = _seasonGates[seasonId];

        // If no gates configured, user is verified by default
        if (gates.length == 0) {
            return true;
        }

        // AND logic: user must pass ALL enabled gates
        for (uint256 i = 0; i < gates.length; i++) {
            if (gates[i].enabled && !_userVerified[seasonId][user][i]) {
                return false;
            }
        }

        return true;
    }

    /// @inheritdoc ISeasonGating
    function getSeasonGates(uint256 seasonId) external view override returns (GateConfig[] memory) {
        return _seasonGates[seasonId];
    }

    /// @inheritdoc ISeasonGating
    function isGateVerified(
        uint256 seasonId,
        uint256 gateIndex,
        address user
    ) external view override returns (bool) {
        return _userVerified[seasonId][user][gateIndex];
    }

    /// @inheritdoc ISeasonGating
    function getGateCount(uint256 seasonId) external view override returns (uint256) {
        return _seasonGates[seasonId].length;
    }

    // ============ Internal Functions ============

    /// @notice Get the password hash for a gate (for verification purposes)
    /// @param seasonId The season
    /// @param gateIndex The gate index
    /// @return configHash The stored config hash
    function getGateConfigHash(uint256 seasonId, uint256 gateIndex) external view returns (bytes32) {
        if (gateIndex >= _seasonGates[seasonId].length) revert InvalidGateIndex();
        return _seasonGates[seasonId][gateIndex].configHash;
    }
}
