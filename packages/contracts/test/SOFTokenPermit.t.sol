// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";

/**
 * @title SOFTokenPermitTest
 * @dev Tests ERC20Permit (EIP-2612) functionality on SOFToken
 */
contract SOFTokenPermitTest is Test {
    SOFToken public token;

    address public owner;
    uint256 public ownerKey;
    address public spender = address(0xBEEF);

    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");

        vm.prank(owner);
        token = new SOFToken("SecondOrder Fun Token", "SOF", INITIAL_SUPPLY);
    }

    /// @dev Helper to build and sign a permit digest
    function _signPermit(uint256 privateKey, address _owner, address _spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, _owner, _spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(privateKey, digest);
    }

    function test_permit_setsAllowance() public {
        uint256 value = 1000 * 10 ** 18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = token.nonces(owner);

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(ownerKey, owner, spender, value, nonce, deadline);

        token.permit(owner, spender, value, deadline, v, r, s);

        assertEq(token.allowance(owner, spender), value, "Allowance should be set");
        assertEq(token.nonces(owner), nonce + 1, "Nonce should increment");
    }

    function test_permit_reverts_expiredDeadline() public {
        uint256 value = 1000 * 10 ** 18;
        uint256 deadline = block.timestamp - 1; // already expired
        uint256 nonce = token.nonces(owner);

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(ownerKey, owner, spender, value, nonce, deadline);

        vm.expectRevert();
        token.permit(owner, spender, value, deadline, v, r, s);
    }

    function test_permit_reverts_wrongSigner() public {
        (, uint256 wrongKey) = makeAddrAndKey("wrong");

        uint256 value = 1000 * 10 ** 18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = token.nonces(owner);

        // Sign with wrong key but claim it's from owner
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(wrongKey, owner, spender, value, nonce, deadline);

        vm.expectRevert();
        token.permit(owner, spender, value, deadline, v, r, s);
    }

    function test_permit_incrementsNonce() public {
        uint256 value = 500 * 10 ** 18;
        uint256 deadline = block.timestamp + 1 hours;

        // First permit
        (uint8 v1, bytes32 r1, bytes32 s1) = _signPermit(ownerKey, owner, spender, value, 0, deadline);
        token.permit(owner, spender, value, deadline, v1, r1, s1);
        assertEq(token.nonces(owner), 1, "Nonce should be 1 after first permit");

        // Second permit
        (uint8 v2, bytes32 r2, bytes32 s2) = _signPermit(ownerKey, owner, spender, value * 2, 1, deadline);
        token.permit(owner, spender, value * 2, deadline, v2, r2, s2);
        assertEq(token.nonces(owner), 2, "Nonce should be 2 after second permit");
    }

    function test_permit_replayReverts() public {
        uint256 value = 1000 * 10 ** 18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = token.nonces(owner);

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(ownerKey, owner, spender, value, nonce, deadline);

        // First call succeeds
        token.permit(owner, spender, value, deadline, v, r, s);

        // Replay with same signature should revert (nonce consumed)
        vm.expectRevert();
        token.permit(owner, spender, value, deadline, v, r, s);
    }
}

contract RaffleTokenPermitTest is Test {
    RaffleToken public token;
    address public owner;
    uint256 public ownerPk;
    address public spender = address(0xBEEF);
    address public admin = address(0xAD);

    function setUp() public {
        (owner, ownerPk) = makeAddrAndKey("owner");
        vm.prank(admin);
        token = new RaffleToken(
            "SecondOrder Season 1", "SOF-1",
            1, "Season 1",
            block.timestamp, block.timestamp + 7 days
        );
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.mint(owner, 100);
        vm.stopPrank();
    }

    function test_permit_setsAllowance() public {
        uint256 value = 50;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = token.nonces(owner);

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner, spender, value, nonce, deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);

        token.permit(owner, spender, value, deadline, v, r, s);

        assertEq(token.allowance(owner, spender), value);
        assertEq(token.nonces(owner), 1);
    }

    function test_decimals_stillZero() public view {
        assertEq(token.decimals(), 0);
    }
}
