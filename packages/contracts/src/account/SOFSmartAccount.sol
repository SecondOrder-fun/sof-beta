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

    // ──────────────── SimpleAccount-compatible execution ────────────────
    //
    // permissionless's `to7702SimpleSmartAccount` adapter encodes calls using
    // eth-infinitism's SimpleAccount selectors:
    //   execute(address,uint256,bytes)            → 0xb61d27f6
    //   executeBatch((address,uint256,bytes)[])   → 0x34fcd5be
    //
    // OZ's ERC-7821 exposes a single `execute(bytes32 mode, bytes executionData)`
    // dispatcher and doesn't expose those selectors. We add thin shims so the
    // standard permissionless flow lands here without needing a custom
    // smart-account adapter.

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function execute(address target, uint256 value, bytes calldata data) external payable onlyEntryPointOrSelf {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly { revert(add(ret, 0x20), mload(ret)) }
        }
    }

    function executeBatch(Call[] calldata calls) external payable onlyEntryPointOrSelf {
        for (uint256 i = 0; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                assembly { revert(add(ret, 0x20), mload(ret)) }
            }
        }
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
