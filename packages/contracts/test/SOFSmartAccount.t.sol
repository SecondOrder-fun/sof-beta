// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFSmartAccount} from "../src/account/SOFSmartAccount.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract SOFSmartAccountTest is Test {
    SOFSmartAccount public singleton;
    address public entryPoint;

    uint256 internal eoaKey;
    address internal eoaAddr;

    function setUp() public {
        singleton = new SOFSmartAccount();
        entryPoint = address(singleton.entryPoint());
        (eoaAddr, eoaKey) = makeAddrAndKey("eoa-user");
    }

    // ──── Deployment ────

    function test_entryPoint_isV08() public view {
        assertTrue(entryPoint != address(0), "EntryPoint should be non-zero");
    }

    // ──── ERC-165 ────

    function test_supportsInterface_ERC721Receiver() public view {
        assertTrue(singleton.supportsInterface(type(IERC721Receiver).interfaceId));
    }

    function test_supportsInterface_ERC1155Receiver() public view {
        assertTrue(singleton.supportsInterface(type(IERC1155Receiver).interfaceId));
    }

    function test_supportsInterface_ERC165() public view {
        assertTrue(singleton.supportsInterface(type(IERC165).interfaceId));
    }

    function test_supportsInterface_unknown_returnsFalse() public view {
        assertFalse(singleton.supportsInterface(bytes4(0xdeadbeef)));
    }

    // ──── Token Receivers ────

    function test_onERC721Received_returnsSelector() public view {
        bytes4 result = singleton.onERC721Received(address(0), address(0), 0, "");
        assertEq(result, IERC721Receiver.onERC721Received.selector);
    }

    function test_onERC1155Received_returnsSelector() public view {
        bytes4 result = singleton.onERC1155Received(address(0), address(0), 0, 0, "");
        assertEq(result, IERC1155Receiver.onERC1155Received.selector);
    }

    function test_onERC1155BatchReceived_returnsSelector() public view {
        uint256[] memory ids = new uint256[](0);
        uint256[] memory amounts = new uint256[](0);
        bytes4 result = singleton.onERC1155BatchReceived(address(0), address(0), ids, amounts, "");
        assertEq(result, IERC1155Receiver.onERC1155BatchReceived.selector);
    }

    // ──── ETH Receiving ────

    function test_receiveETH() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(singleton).call{value: 1 ether}("");
        assertTrue(success, "Should accept ETH");
        assertEq(address(singleton).balance, 1 ether);
    }

    // ──── ERC-7821 Execution Mode ────

    function test_supportsExecutionMode_batchDefault() public view {
        // forge-lint: disable-next-line(unsafe-typecast) Safe: literal hex value representing batch-default execution mode
        bytes32 mode = bytes32(hex"0100000000000000000000000000000000000000000000000000000000000000");
        assertTrue(singleton.supportsExecutionMode(mode));
    }

    function test_supportsExecutionMode_singleCall_returnsFalse() public view {
        bytes32 mode = bytes32(0);
        assertFalse(singleton.supportsExecutionMode(mode));
    }
}
