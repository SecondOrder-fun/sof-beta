// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPaymaster, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SOFSmartAccount} from "../account/SOFSmartAccount.sol";
import {SOFSmartAccountFactory} from "../account/SOFSmartAccountFactory.sol";

interface IRaffleCurveRegistry {
    function isSofCurve(address) external view returns (bool);
}

/// @title SOFPaymaster
/// @notice ERC-4337 paymaster that sponsors UserOps from SOFSmartAccountFactory-deployed
///         accounts when every inner call target is allowlisted.
/// @dev Validation is fully on-chain (no off-chain signer):
///        1. `userOp.sender` must equal `factory.getAddress(SOFSmartAccount(sender).signer())`
///           — proves the SMA is the deterministic CREATE2 product of our factory.
///        2. `userOp.callData` must be a call to `ERC7821.execute(bytes32, bytes)` in batch
///           mode (the only mode OZ ERC-7821 implements). Every `Execution.target` in the
///           decoded `Execution[]` must be in the static allowlist OR registered as a SOF
///           curve via `Raffle.isSofCurve(target)`.
///      Per spec §3.3 (`docs/superpowers/specs/2026-05-05-gasless-rewrite-design.md`).
contract SOFPaymaster is IPaymaster, AccessControl {
    error NotEntryPoint();
    error NotFactoryAccount();
    error TargetNotAllowed(address target);
    error UnsupportedExecuteMode(bytes32 mode);
    error InvalidCallData();

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice ERC-4337 EntryPoint allowed to call validation/postOp hooks.
    address public immutable entryPoint;

    /// @notice Factory whose CREATE2 lineage authorises a sender.
    SOFSmartAccountFactory public immutable factory;

    /// @notice Raffle contract whose curve registry expands the allowlist
    ///         dynamically (per-season bonding curves register here).
    IRaffleCurveRegistry public immutable raffle;

    /// @notice Targets always permitted as inner-call destinations.
    mapping(address => bool) public staticAllowlist;

    event TargetAllowlisted(address indexed target, bool allowed);

    constructor(
        address _entryPoint,
        address _factory,
        address _raffle,
        address[] memory initialAllowlist
    ) {
        entryPoint = _entryPoint;
        factory = SOFSmartAccountFactory(_factory);
        raffle = IRaffleCurveRegistry(_raffle);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        for (uint256 i = 0; i < initialAllowlist.length; i++) {
            staticAllowlist[initialAllowlist[i]] = true;
            emit TargetAllowlisted(initialAllowlist[i], true);
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────────

    /// @notice Add or remove a target from the static allowlist.
    function setAllowlisted(address target, bool allowed) external onlyRole(ADMIN_ROLE) {
        staticAllowlist[target] = allowed;
        emit TargetAllowlisted(target, allowed);
    }

    // ──────────────────────────────────────────────────────────────────
    // IPaymaster
    // ──────────────────────────────────────────────────────────────────

    /// @inheritdoc IPaymaster
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) external view returns (bytes memory context, uint256 validationData) {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        // 1. Sender must be the factory's CREATE2 product for its SignerECDSA owner.
        //    `payable` cast is needed because SOFSmartAccount has a payable receive().
        address signerAddr = SOFSmartAccount(payable(userOp.sender)).signer();
        if (factory.getAddress(signerAddr) != userOp.sender) revert NotFactoryAccount();

        // 2. Decode ERC-7821 execute(mode, data) and validate every inner target.
        _validateCallTargets(userOp.callData);

        return ("", 0);
    }

    /// @inheritdoc IPaymaster
    /// @dev No-op. We only assert the caller is the EntryPoint per ERC-4337 §6.
    function postOp(
        PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) external view {
        if (msg.sender != entryPoint) revert NotEntryPoint();
    }

    // ──────────────────────────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────────────────────────

    /// @dev Decodes `ERC7821.execute(bytes32 mode, bytes executionData)` from
    ///      `callData` and walks every `Execution.target` through {_checkTarget}.
    ///      Reverts on any non-allowed target or on unsupported mode.
    function _validateCallTargets(bytes calldata callData) internal view {
        // execute(bytes32,bytes) — selector (4) + head(mode) (32) + head(offset) (32) + tail.
        if (callData.length < 4 + 32 + 32) revert InvalidCallData();
        bytes4 selector = bytes4(callData[:4]);
        if (selector != ERC7821.execute.selector) revert InvalidCallData();

        (bytes32 mode, bytes memory executionData) = abi.decode(callData[4:], (bytes32, bytes));

        // ERC-7821 only supports CALLTYPE_BATCH (0x01 in the most-significant byte
        // of `mode`). `bytes1(mode)` truncates a bytes32 to its leftmost (MSB)
        // byte — same as OZ ERC7579Utils' `Packing.extract_32_1(value, 0)`.
        if (bytes1(mode) != 0x01) revert UnsupportedExecuteMode(mode);

        Execution[] memory calls = abi.decode(executionData, (Execution[]));
        for (uint256 i = 0; i < calls.length; i++) {
            _checkTarget(calls[i].target);
        }
    }

    /// @dev Allow if the target is in the static allowlist or registered as a
    ///      SOF curve. Otherwise revert with the offending target.
    function _checkTarget(address target) internal view {
        if (staticAllowlist[target]) return;
        if (raffle.isSofCurve(target)) return;
        revert TargetNotAllowed(target);
    }

    receive() external payable {}
}
