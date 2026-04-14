// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IEntryPoint, IPaymaster, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";

error InvalidSigner();
error InvalidSignature();
error InsufficientDeposit();

/// @title SOFPaymaster
/// @notice Verifying paymaster for SecondOrder.fun — the backend relay wallet signs
///         approval for each UserOperation and this contract validates that signature
///         before agreeing to sponsor the gas.
/// @dev Designed for EntryPoint v0.8 (packed UserOperation format).

contract SOFPaymaster is IPaymaster, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice The canonical ERC-4337 EntryPoint this paymaster is bound to.
    IEntryPoint public immutable ENTRY_POINT;

    /// @notice Backend relay wallet whose signature authorises gas sponsorship.
    address public verifyingSigner;

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    /// @param _entryPoint Address of the ERC-4337 EntryPoint contract.
    /// @param _verifyingSigner Backend relay wallet that signs UserOp approvals.
    /// @param _owner Contract owner (can update signer & withdraw deposits).
    constructor(
        IEntryPoint _entryPoint,
        address _verifyingSigner,
        address _owner
    ) Ownable(_owner) {
        if (_verifyingSigner == address(0)) revert InvalidSigner();
        ENTRY_POINT = _entryPoint;
        verifyingSigner = _verifyingSigner;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────────────

    modifier onlyEntryPoint() {
        require(msg.sender == address(ENTRY_POINT), "SOFPaymaster: not EntryPoint");
        _;
    }

    // ──────────────────────────────────────────────────────────────────────
    // IPaymaster implementation
    // ──────────────────────────────────────────────────────────────────────

    /// @inheritdoc IPaymaster
    /// @dev The backend signs `userOpHash` with its private key and appends the
    ///      65-byte signature to `paymasterAndData` after the standard 52-byte
    ///      prefix (20 address + 16 verificationGasLimit + 16 postOpGasLimit).
    ///      Validation data layout: `authorizer` (20 bytes) | `validUntil` (6) | `validAfter` (6)
    ///      We return 0 for success or 1 (SIG_VALIDATION_FAILED) for failure.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 /* maxCost */
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // paymasterAndData layout:
        //   [0:20]   paymaster address
        //   [20:36]  paymasterVerificationGasLimit (uint128)
        //   [36:52]  paymasterPostOpGasLimit (uint128)
        //   [52:117] signature (65 bytes: r[32] + s[32] + v[1])
        bytes calldata paymasterAndData = userOp.paymasterAndData;

        if (paymasterAndData.length < 117) {
            // Not enough data for a valid signature — return SIG_VALIDATION_FAILED
            return ("", 1);
        }

        bytes calldata signature = paymasterAndData[52:117];

        // Recover signer from the EIP-191 signed hash of the userOpHash
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);

        if (recovered != verifyingSigner) {
            // Signature doesn't match — return SIG_VALIDATION_FAILED (1)
            return ("", 1);
        }

        // Valid signature — return success (0) with empty context (no postOp needed)
        return ("", 0);
    }

    /// @inheritdoc IPaymaster
    /// @dev No post-op logic needed for a verifying paymaster.
    function postOp(
        PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) external onlyEntryPoint {
        // No-op: verifying paymaster doesn't need post-operation processing.
    }

    // ──────────────────────────────────────────────────────────────────────
    // Deposit management
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Deposit ETH to the EntryPoint on behalf of this paymaster.
    function deposit() external payable {
        ENTRY_POINT.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw ETH from this paymaster's EntryPoint deposit.
    /// @param withdrawAddress Recipient of the withdrawn ETH.
    /// @param amount Amount of ETH to withdraw (in wei).
    function withdrawTo(address payable withdrawAddress, uint256 amount) external onlyOwner {
        ENTRY_POINT.withdrawTo(withdrawAddress, amount);
        emit Withdrawn(withdrawAddress, amount);
    }

    /// @notice Query this paymaster's deposit balance on the EntryPoint.
    function getDeposit() external view returns (uint256) {
        return ENTRY_POINT.balanceOf(address(this));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Update the verifying signer address.
    /// @param newSigner New backend relay wallet address.
    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidSigner();
        address oldSigner = verifyingSigner;
        verifyingSigner = newSigner;
        emit SignerUpdated(oldSigner, newSigner);
    }

    /// @notice Allow the contract to receive ETH directly (for convenience).
    receive() external payable {}
}
