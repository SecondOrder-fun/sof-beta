// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {SignerERC7702} from "@openzeppelin/contracts/utils/cryptography/signers/SignerERC7702.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title SOFSmartAccount
/// @notice Singleton ERC-7702 delegate contract for SecondOrder.fun.
/// @dev EOAs delegate to this contract via EIP-7702 to gain ERC-4337
///      compatibility (gas sponsorship, batched execution).
///      Stateless — all per-account state lives in the EOA's storage
///      via ERC-7201 namespaced storage in the OZ base contracts.
contract SOFSmartAccount is Account, SignerERC7702, ERC7821, IERC721Receiver, IERC1155Receiver {

    /// @dev Allow the ERC-4337 EntryPoint to execute via ERC-7821,
    ///      in addition to the EOA itself (default in ERC7821).
    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view virtual override returns (bool) {
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    // ──────────────── Token Receivers ────────────────

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    // ──────────────── ERC-165 ────────────────

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
