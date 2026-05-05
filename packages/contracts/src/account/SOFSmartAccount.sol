// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {SignerECDSA} from "@openzeppelin/contracts/utils/cryptography/signers/SignerECDSA.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {AbstractSigner} from "@openzeppelin/contracts/utils/cryptography/signers/AbstractSigner.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title SOFSmartAccount
/// @notice Counterfactual ERC-4337 v0.8 smart account, owned by a single EOA.
/// @dev Composes OpenZeppelin's audited primitives:
///      - {Account} ERC-4337 v0.8 base — wires `validateUserOp` to call
///        `_rawSignatureValidation(_signableUserOpHash(...), signature)`.
///        EntryPoint v0.8 produces an EIP-712 typed-data `userOpHash` natively,
///        so {Account._signableUserOpHash} returns it unchanged. We do NOT
///        override it — wallets show structured typed data from the v0.8
///        userOpHash itself. Adding another wrap layer here would break the
///        4337 validation flow used by bundlers.
///      - {SignerECDSA} stores the owner address (set immutably at
///        construction) and validates ECDSA recovery against it. Exposes a
///        public `signer()` getter used by the factory and the paymaster.
///      - {ERC7739} provides the ERC-1271 `isValidSignature` entry point with
///        nested EIP-712 (typed-data + personal-sign) verification, so
///        offchain consumers (e.g. permit2, EIP-1271-aware dapps) get
///        replay-proof signed messages without the smart account writing the
///        wrap by hand.
///      - {ERC7821} provides batched `execute(bytes32 mode, bytes data)` for
///        multi-call UserOps. We override `_erc7821AuthorizedExecutor` to
///        permit the canonical EntryPoint as caller in addition to self.
///      Owner is set at construction; the factory passes the target EOA. One
///      SOFSmartAccount per EOA per chain, address derived counterfactually
///      via the factory's CREATE2.
contract SOFSmartAccount is
    Account,
    SignerECDSA,
    ERC7739,
    ERC7821,
    IERC721Receiver,
    IERC1155Receiver
{
    constructor(address signerAddr)
        EIP712("SOF Smart Account", "1")
        SignerECDSA(signerAddr)
    {}

    // ──────────────────────────────────────────────────────────────────
    // Diamond-inheritance resolution
    // ──────────────────────────────────────────────────────────────────

    /// @dev `_rawSignatureValidation` is virtual in {AbstractSigner} and
    ///      overridden in both {SignerECDSA} (recovers ECDSA against the
    ///      stored signer) and inherited via {ERC7739} (which calls
    ///      `_rawSignatureValidation` on the wrapped digest). We bind the
    ///      resolution to {SignerECDSA}'s recovery — calling
    ///      `super._rawSignatureValidation` here would re-enter ERC7739 and
    ///      recurse. The explicit call below short-circuits to ECDSA.
    function _rawSignatureValidation(bytes32 hash, bytes calldata signature)
        internal
        view
        virtual
        override(AbstractSigner, SignerECDSA)
        returns (bool)
    {
        return SignerECDSA._rawSignatureValidation(hash, signature);
    }

    /// @dev Permit the canonical ERC-4337 EntryPoint (v0.8) to invoke
    ///      {ERC7821.execute} in addition to the contract itself. Anyone else
    ///      hits the `Account.AccountUnauthorized` revert in {ERC7821.execute}.
    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view virtual override returns (bool) {
        return caller == address(entryPoint())
            || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    // ──────────────────────────────────────────────────────────────────
    // Token receivers
    // ──────────────────────────────────────────────────────────────────

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    // ──────────────────────────────────────────────────────────────────
    // ERC-165
    // ──────────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public pure virtual returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    // ──────────────────────────────────────────────────────────────────
    // Receive ETH (resolves diamond inheritance with Account.receive)
    // ──────────────────────────────────────────────────────────────────

    receive() external payable override {}
}
