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
///      Follows the standard VerifyingPaymaster pattern with validUntil/validAfter
///      timestamps for signature expiry.

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

    /// @notice Compute the digest the off-chain signer signs over.
    /// @dev We can't sign over EntryPoint's `userOpHash` directly because it
    ///      includes `paymasterAndData` in full — and `paymasterAndData`
    ///      contains the signature we are about to produce. To break the
    ///      cycle we hash the "canonical" portion of the userOp ourselves and
    ///      include only the prefix of `paymasterAndData` (paymaster address
    ///      + gas limits, the bytes before validUntil/validAfter/signature).
    ///      Mirrors the standard eth-infinitism VerifyingPaymaster pattern.
    function getHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        // First 52 bytes of paymasterAndData = paymaster + verifGas + postOpGas;
        // everything from byte 52 on (validUntil/validAfter/signature) is what
        // we're signing over, so we must NOT include it in the input hash.
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData[0:52]),
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    /// @inheritdoc IPaymaster
    /// @dev paymasterAndData layout:
    ///        [0:20]   paymaster address
    ///        [20:36]  paymasterVerificationGasLimit (uint128)
    ///        [36:52]  paymasterPostOpGasLimit (uint128)
    ///        [52:58]  validUntil (uint48) — 0 means no expiry
    ///        [58:64]  validAfter (uint48) — 0 means immediately valid
    ///        [64:129] signature (65 bytes: r[32] + s[32] + v[1])
    ///
    ///      Returns packed validationData per ERC-4337:
    ///        `uint256(sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208)`
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 /* maxCost */
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        bytes calldata paymasterAndData = userOp.paymasterAndData;

        // Need at least 129 bytes: 52 (prefix) + 6 (validUntil) + 6 (validAfter) + 65 (signature)
        if (paymasterAndData.length < 129) {
            return ("", 1);
        }

        uint48 validUntil = uint48(bytes6(paymasterAndData[52:58]));
        uint48 validAfter = uint48(bytes6(paymasterAndData[58:64]));
        bytes calldata signature = paymasterAndData[64:129];

        bytes32 hash = getHash(userOp, validUntil, validAfter);
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);

        uint256 sigFailed = (recovered != verifyingSigner) ? 1 : 0;
        validationData = sigFailed | (uint256(validUntil) << 160) | (uint256(validAfter) << 208);

        return ("", validationData);
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
