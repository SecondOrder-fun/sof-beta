// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFPaymaster, InvalidSigner} from "../src/paymaster/SOFPaymaster.sol";
import {IEntryPoint, IPaymaster, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal mock EntryPoint that implements the subset of IEntryPoint used by SOFPaymaster.
contract MockEntryPoint {
    mapping(address => uint256) public deposits;

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        require(deposits[msg.sender] >= withdrawAmount, "insufficient deposit");
        deposits[msg.sender] -= withdrawAmount;
        (bool success,) = withdrawAddress.call{value: withdrawAmount}("");
        require(success, "transfer failed");
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    // Stub functions to satisfy IEntryPoint interface if needed — not called in tests
    function getNonce(address, uint192) external pure returns (uint256) { return 0; }
    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}
    function handleOps(PackedUserOperation[] calldata, address payable) external {}

    receive() external payable {}
}

contract SOFPaymasterTest is Test {
    using MessageHashUtils for bytes32;

    SOFPaymaster public paymaster;
    MockEntryPoint public entryPoint;

    address public owner;
    address public signer;
    uint256 public signerPk;
    address public user;

    function setUp() public {
        owner = address(this);
        (signer, signerPk) = makeAddrAndKey("signer");
        user = makeAddr("user");

        entryPoint = new MockEntryPoint();
        paymaster = new SOFPaymaster(
            IEntryPoint(address(entryPoint)),
            signer,
            owner
        );
    }

    // ──────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────

    /// @dev Build a minimal PackedUserOperation with the given paymasterAndData.
    function _buildUserOp(bytes memory paymasterAndData) internal view returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: user,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: paymasterAndData,
            signature: ""
        });
    }

    /// @dev Build valid paymasterAndData by signing the contract-side `getHash`.
    ///      The userOp must be passed in with the paymasterAndData prefix already
    ///      populated so `getHash` can hash `paymasterAndData[0:52]` correctly.
    function _signPaymasterData(
        PackedUserOperation memory userOp,
        uint48 validUntil,
        uint48 validAfter
    ) internal view returns (bytes memory) {
        bytes32 hash = paymaster.getHash(userOp, validUntil, validAfter);
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethSignedHash);

        // Layout: paymaster(20) + verificationGasLimit(16) + postOpGasLimit(16)
        //       + validUntil(6) + validAfter(6) + sig(65) = 129
        return abi.encodePacked(
            address(paymaster),  // 20 bytes
            uint128(0),          // verificationGasLimit — 16 bytes
            uint128(0),          // postOpGasLimit — 16 bytes
            validUntil,          // 6 bytes (uint48)
            validAfter,          // 6 bytes (uint48)
            r,                   // 32 bytes
            s,                   // 32 bytes
            v                    // 1 byte
        );
    }

    /// @dev Build a userOp + valid paymasterAndData together: first construct a
    ///      userOp whose paymasterAndData prefix matches what we'll sign, then
    ///      sign, then splice the signature in. Returns the final userOp.
    function _userOpWithSig(uint48 validUntil, uint48 validAfter)
        internal
        view
        returns (PackedUserOperation memory)
    {
        // Prefix has to be present when we hash; the trailing signature bytes
        // are what we're computing, so they're filled with zeros for the hash.
        bytes memory prefix = abi.encodePacked(
            address(paymaster),
            uint128(0),
            uint128(0),
            validUntil,
            validAfter,
            bytes32(0),  // r placeholder
            bytes32(0),  // s placeholder
            uint8(0)     // v placeholder
        );
        PackedUserOperation memory userOp = _buildUserOp(prefix);
        bytes memory finalData = _signPaymasterData(userOp, validUntil, validAfter);
        userOp.paymasterAndData = finalData;
        return userOp;
    }

    /// @dev Helper to extract packed validationData components.
    function _unpackValidationData(uint256 validationData)
        internal
        pure
        returns (uint256 sigFailed, uint48 validUntil, uint48 validAfter)
    {
        // The authorizer is the lowest 160 bits, but for our paymaster it is 0 or 1.
        sigFailed = validationData & 1;
        validUntil = uint48(validationData >> 160);
        validAfter = uint48(validationData >> 208);
    }

    // ──────────────────────────────────────────────────────────────────
    // Tests
    // ──────────────────────────────────────────────────────────────────

    function test_constructorSetsSigner() public view {
        assertEq(paymaster.verifyingSigner(), signer, "signer mismatch");
        assertEq(paymaster.owner(), owner, "owner mismatch");
        assertEq(address(paymaster.ENTRY_POINT()), address(entryPoint), "entryPoint mismatch");
    }

    function test_constructorRevertsZeroSigner() public {
        vm.expectRevert(InvalidSigner.selector);
        new SOFPaymaster(IEntryPoint(address(entryPoint)), address(0), owner);
    }

    function test_deposit() public {
        uint256 amount = 1 ether;
        paymaster.deposit{value: amount}();
        assertEq(entryPoint.balanceOf(address(paymaster)), amount, "deposit not reflected");
        assertEq(paymaster.getDeposit(), amount, "getDeposit mismatch");
    }

    function test_setSigner_onlyOwner() public {
        address newSigner = makeAddr("newSigner");

        // Owner can update
        paymaster.setSigner(newSigner);
        assertEq(paymaster.verifyingSigner(), newSigner, "signer not updated");

        // Non-owner reverts
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        paymaster.setSigner(makeAddr("anotherSigner"));
    }

    function test_setSigner_revertsZeroAddress() public {
        vm.expectRevert(InvalidSigner.selector);
        paymaster.setSigner(address(0));
    }

    function test_validatePaymasterUserOp_validSigner() public {
        PackedUserOperation memory userOp = _userOpWithSig(0, 0);

        vm.prank(address(entryPoint));
        // The userOpHash arg is ignored by the new SOFPaymaster (it derives its
        // own digest via getHash). Pass any value.
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);

        (uint256 sigFailed,,) = _unpackValidationData(validationData);
        assertEq(sigFailed, 0, "should return 0 for valid signature");
        assertEq(context.length, 0, "context should be empty");
    }

    function test_validatePaymasterUserOp_withTimeBounds() public {
        uint48 validUntil = uint48(block.timestamp + 300);
        uint48 validAfter = uint48(block.timestamp);

        PackedUserOperation memory userOp = _userOpWithSig(validUntil, validAfter);

        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);

        (uint256 sigFailed, uint48 retValidUntil, uint48 retValidAfter) = _unpackValidationData(validationData);
        assertEq(sigFailed, 0, "should return 0 for valid signature");
        assertEq(retValidUntil, validUntil, "validUntil mismatch");
        assertEq(retValidAfter, validAfter, "validAfter mismatch");
        assertEq(context.length, 0, "context should be empty");
    }

    function test_validatePaymasterUserOp_invalidSigner() public {
        // Sign with a different key — signature recovers to wrong address.
        (, uint256 wrongPk) = makeAddrAndKey("wrongSigner");
        uint48 validUntil = 0;
        uint48 validAfter = 0;

        bytes memory prefix = abi.encodePacked(
            address(paymaster), uint128(0), uint128(0),
            validUntil, validAfter,
            bytes32(0), bytes32(0), uint8(0)
        );
        PackedUserOperation memory userOp = _buildUserOp(prefix);

        bytes32 hash = paymaster.getHash(userOp, validUntil, validAfter);
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, ethSignedHash);

        userOp.paymasterAndData = abi.encodePacked(
            address(paymaster), uint128(0), uint128(0),
            validUntil, validAfter,
            r, s, v
        );

        vm.prank(address(entryPoint));
        (, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);

        (uint256 sigFailed,,) = _unpackValidationData(validationData);
        assertEq(sigFailed, 1, "should return 1 for invalid signature");
    }

    function test_validatePaymasterUserOp_shortData() public {
        bytes memory shortData = new bytes(51);
        PackedUserOperation memory userOp = _buildUserOp(shortData);

        vm.prank(address(entryPoint));
        (, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);

        assertEq(validationData, 1, "should return 1 for short data");
    }

    function test_validatePaymasterUserOp_onlyEntryPoint() public {
        PackedUserOperation memory userOp = _buildUserOp("");

        vm.prank(user);
        vm.expectRevert("SOFPaymaster: not EntryPoint");
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);
    }

    function test_validatePaymasterUserOp_replayWithDifferentTimeBounds() public {
        // Sign for one set of bounds, then tamper validUntil before submission.
        uint48 validUntil = uint48(block.timestamp + 300);
        uint48 validAfter = uint48(block.timestamp);

        PackedUserOperation memory userOp = _userOpWithSig(validUntil, validAfter);

        // Tamper validUntil bytes [52:58] in paymasterAndData
        uint48 tamperedValidUntil = uint48(block.timestamp + 3600);
        // Read sig bytes from the trailing 65 bytes of paymasterAndData
        bytes memory pmData = userOp.paymasterAndData;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            // offset = 32 (length prefix) + 64 (start of sig bytes [64:64+65])
            let p := add(pmData, 96)
            r := mload(p)
            s := mload(add(p, 32))
            v := byte(0, mload(add(p, 64)))
        }
        userOp.paymasterAndData = abi.encodePacked(
            address(paymaster), uint128(0), uint128(0),
            tamperedValidUntil, validAfter,
            r, s, v
        );

        vm.prank(address(entryPoint));
        (, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);

        (uint256 sigFailed,,) = _unpackValidationData(validationData);
        assertEq(sigFailed, 1, "should fail when time bounds are tampered");
    }

    function test_withdrawTo_onlyOwner() public {
        // Fund the paymaster deposit
        paymaster.deposit{value: 1 ether}();

        address payable recipient = payable(makeAddr("recipient"));

        // Owner can withdraw
        paymaster.withdrawTo(recipient, 0.5 ether);
        assertEq(recipient.balance, 0.5 ether, "recipient should receive ETH");
        assertEq(paymaster.getDeposit(), 0.5 ether, "deposit should decrease");

        // Non-owner reverts
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        paymaster.withdrawTo(recipient, 0.1 ether);
    }
}
