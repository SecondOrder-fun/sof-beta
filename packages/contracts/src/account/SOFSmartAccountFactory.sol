// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";

/// @title SOFSmartAccountFactory
/// @notice Deterministic CREATE2 factory that deploys exactly one
///         {SOFSmartAccount} per EOA owner per chain.
/// @dev    The salt is `keccak256(abi.encodePacked(owner))` so the resulting
///         address is a pure function of `(factory, owner)`. {createAccount} is
///         idempotent: a second call for the same owner returns the existing
///         instance without redeploying or re-emitting the event. Off-chain
///         consumers can predict the address via {getAddress} and treat the
///         account as counterfactual until the first sponsored UserOp deploys
///         it (initCode path) or anyone calls {createAccount} directly.
contract SOFSmartAccountFactory {
    error SOFSmartAccountFactoryInvalidOwner();

    /// @notice Emitted on the first deployment of `account` for `owner`.
    /// @dev    Not emitted on idempotent re-calls. Off-chain indexers must
    ///         supplement this signal with a `code.length` check, since a
    ///         direct {createAccount} call after deployment will not re-emit.
    event AccountCreated(address indexed owner, address indexed account);

    /// @notice Predict the address of `owner`'s SOFSmartAccount.
    /// @dev    Mirrors {createAccount}'s salt + initCode exactly so the
    ///         predicted address matches the deployed address.
    function getAddress(address owner) public view returns (address) {
        if (owner == address(0)) revert SOFSmartAccountFactoryInvalidOwner();
        return Create2.computeAddress(_salt(owner), keccak256(_initCode(owner)));
    }

    /// @notice Deploy `owner`'s SOFSmartAccount, or return the existing one.
    /// @dev    Idempotent. Returns the same address on every call for a given
    ///         owner; only emits {AccountCreated} on the first deployment.
    ///         The `predicted.code.length > 0` short-circuit is monotonic
    ///         post-Cancun: SOFSmartAccount has no `selfdestruct` opcode in
    ///         its inheritance chain, and EIP-6780 prevents code-clearing
    ///         outside the contract's creation transaction.
    function createAccount(address owner) external returns (SOFSmartAccount) {
        if (owner == address(0)) revert SOFSmartAccountFactoryInvalidOwner();
        address predicted = getAddress(owner);
        if (predicted.code.length > 0) {
            return SOFSmartAccount(payable(predicted));
        }
        SOFSmartAccount account = new SOFSmartAccount{salt: _salt(owner)}(owner);
        emit AccountCreated(owner, address(account));
        return account;
    }

    // ──────────────────────────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────────────────────────

    function _salt(address owner) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner));
    }

    function _initCode(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(type(SOFSmartAccount).creationCode, abi.encode(owner));
    }
}
