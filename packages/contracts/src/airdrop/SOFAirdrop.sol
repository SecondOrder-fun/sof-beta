// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SOFToken} from "../token/SOFToken.sol";

/// @title SOFAirdrop
/// @notice One-time beta airdrop + daily SOF drip with optional Farcaster anti-sybil
/// @dev Farcaster-verified users get full initialAmount; unverified get basicAmount
contract SOFAirdrop is AccessControl, ReentrancyGuard, EIP712 {
    // ============ Errors ============

    error AlreadyClaimed();
    error CooldownNotElapsed(uint256 nextClaimAt);
    error AttestationExpired();
    error InvalidAttestor();
    error ZeroAddress();

    // ============ Events ============

    event InitialClaimed(address indexed user, uint256 amount, bool farcasterVerified);
    event DailyClaimed(address indexed user, uint256 amount);

    // ============ Constants ============

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    bytes32 private constant FARCASTER_ATTESTATION_TYPEHASH =
        keccak256("FarcasterAttestation(address wallet,uint256 fid,uint256 deadline)");

    // ============ State ============

    SOFToken public immutable sofToken;
    uint256 public initialAmount;
    uint256 public basicAmount;
    uint256 public dailyAmount;
    uint256 public cooldown;
    address public attestor;

    mapping(address => bool) public hasClaimed;
    mapping(address => uint256) public lastDailyClaim;

    // ============ Constructor ============

    /// @param _sofToken Address of the SOFToken contract
    /// @param _attestor Backend signer for FID attestation
    /// @param _initialAmount Full claim amount (Farcaster-verified)
    /// @param _basicAmount Reduced claim amount (no Farcaster)
    /// @param _dailyAmount Daily drip amount
    /// @param _cooldown Seconds between daily claims
    constructor(
        address _sofToken,
        address _attestor,
        uint256 _initialAmount,
        uint256 _basicAmount,
        uint256 _dailyAmount,
        uint256 _cooldown
    ) EIP712("SecondOrder.fun SOFAirdrop", "1") {
        if (_sofToken == address(0)) revert ZeroAddress();
        if (_attestor == address(0)) revert ZeroAddress();

        sofToken = SOFToken(_sofToken);
        attestor = _attestor;
        initialAmount = _initialAmount;
        basicAmount = _basicAmount;
        dailyAmount = _dailyAmount;
        cooldown = _cooldown;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ============ Claim Functions ============

    /// @notice One-time initial claim with Farcaster FID attestation (full amount)
    /// @param fid The Farcaster user ID
    /// @param deadline Signature expiration timestamp
    /// @param v ECDSA recovery id
    /// @param r ECDSA signature component
    /// @param s ECDSA signature component
    function claimInitial(
        uint256 fid,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        if (block.timestamp > deadline) revert AttestationExpired();

        bytes32 structHash = keccak256(
            abi.encode(FARCASTER_ATTESTATION_TYPEHASH, msg.sender, fid, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, v, r, s);

        if (recoveredSigner != attestor) revert InvalidAttestor();

        hasClaimed[msg.sender] = true;
        sofToken.mint(msg.sender, initialAmount);

        emit InitialClaimed(msg.sender, initialAmount, true);
    }

    /// @notice One-time initial claim without Farcaster (reduced amount)
    function claimInitialBasic() external nonReentrant {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        hasClaimed[msg.sender] = true;
        sofToken.mint(msg.sender, basicAmount);

        emit InitialClaimed(msg.sender, basicAmount, false);
    }

    /// @notice Daily refill claim (must have completed initial claim)
    function claimDaily() external nonReentrant {
        if (!hasClaimed[msg.sender]) revert AlreadyClaimed();

        uint256 lastClaim = lastDailyClaim[msg.sender];
        if (lastClaim != 0) {
            uint256 nextClaimAt = lastClaim + cooldown;
            if (block.timestamp < nextClaimAt) revert CooldownNotElapsed(nextClaimAt);
        }

        lastDailyClaim[msg.sender] = block.timestamp;
        sofToken.mint(msg.sender, dailyAmount);

        emit DailyClaimed(msg.sender, dailyAmount);
    }

    // ============ Relayer Functions ============

    /// @notice Relay a Farcaster-verified initial claim on behalf of a user
    /// @param user The user address to claim for
    /// @param fid The Farcaster user ID
    /// @param deadline Signature expiration timestamp
    /// @param v ECDSA recovery id
    /// @param r ECDSA signature component
    /// @param s ECDSA signature component
    function claimInitialFor(
        address user,
        uint256 fid,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (hasClaimed[user]) revert AlreadyClaimed();
        if (block.timestamp > deadline) revert AttestationExpired();

        bytes32 structHash = keccak256(
            abi.encode(FARCASTER_ATTESTATION_TYPEHASH, user, fid, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, v, r, s);

        if (recoveredSigner != attestor) revert InvalidAttestor();

        hasClaimed[user] = true;
        sofToken.mint(user, initialAmount);

        emit InitialClaimed(user, initialAmount, true);
    }

    /// @notice Relay a basic initial claim on behalf of a user
    /// @param user The user address to claim for
    function claimInitialBasicFor(address user) external onlyRole(RELAYER_ROLE) nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (hasClaimed[user]) revert AlreadyClaimed();

        hasClaimed[user] = true;
        sofToken.mint(user, basicAmount);

        emit InitialClaimed(user, basicAmount, false);
    }

    /// @notice Relay a daily claim on behalf of a user
    /// @param user The user address to claim for
    function claimDailyFor(address user) external onlyRole(RELAYER_ROLE) nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (!hasClaimed[user]) revert AlreadyClaimed();

        uint256 lastClaim = lastDailyClaim[user];
        if (lastClaim != 0) {
            uint256 nextClaimAt = lastClaim + cooldown;
            if (block.timestamp < nextClaimAt) revert CooldownNotElapsed(nextClaimAt);
        }

        lastDailyClaim[user] = block.timestamp;
        sofToken.mint(user, dailyAmount);

        emit DailyClaimed(user, dailyAmount);
    }

    // ============ Admin Functions ============

    /// @notice Set claim amounts
    function setAmounts(uint256 _initial, uint256 _basic, uint256 _daily) external onlyRole(DEFAULT_ADMIN_ROLE) {
        initialAmount = _initial;
        basicAmount = _basic;
        dailyAmount = _daily;
    }

    /// @notice Set cooldown between daily claims
    function setCooldown(uint256 _cooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        cooldown = _cooldown;
    }

    /// @notice Set the attestor address for FID verification
    function setAttestor(address _attestor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_attestor == address(0)) revert ZeroAddress();
        attestor = _attestor;
    }
}
