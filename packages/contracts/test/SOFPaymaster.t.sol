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

    /// @dev Build valid paymasterAndData with a proper signature over `userOpHash`.
    function _signPaymasterData(bytes32 userOpHash) internal view returns (bytes memory) {
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethSignedHash);

        // Layout: paymaster(20) + verificationGasLimit(16) + postOpGasLimit(16) + sig(65) = 117
        // Use abi.encodePacked for correctness instead of manual assembly.
        bytes memory data = abi.encodePacked(
            address(paymaster),  // 20 bytes
            uint128(0),          // verificationGasLimit — 16 bytes
            uint128(0),          // postOpGasLimit — 16 bytes
            r,                   // 32 bytes
            s,                   // 32 bytes
            v                    // 1 byte
        );

        return data;
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
        bytes32 userOpHash = keccak256("test-user-op");
        bytes memory paymasterData = _signPaymasterData(userOpHash);
        PackedUserOperation memory userOp = _buildUserOp(paymasterData);

        // Call from entryPoint
        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, userOpHash, 0);

        assertEq(validationData, 0, "should return 0 for valid signature");
        assertEq(context.length, 0, "context should be empty");
    }

    function test_validatePaymasterUserOp_invalidSigner() public {
        // Sign with a different key
        (, uint256 wrongPk) = makeAddrAndKey("wrongSigner");
        bytes32 userOpHash = keccak256("test-user-op");
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, ethSignedHash);

        bytes memory data = abi.encodePacked(
            address(paymaster),
            uint128(0),
            uint128(0),
            r, s, v
        );

        PackedUserOperation memory userOp = _buildUserOp(data);

        vm.prank(address(entryPoint));
        (, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, userOpHash, 0);

        assertEq(validationData, 1, "should return 1 for invalid signature");
    }

    function test_validatePaymasterUserOp_shortData() public {
        // paymasterAndData too short — should return SIG_VALIDATION_FAILED
        bytes memory shortData = new bytes(51);
        PackedUserOperation memory userOp = _buildUserOp(shortData);

        vm.prank(address(entryPoint));
        (, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, keccak256("x"), 0);

        assertEq(validationData, 1, "should return 1 for short data");
    }

    function test_validatePaymasterUserOp_onlyEntryPoint() public {
        PackedUserOperation memory userOp = _buildUserOp("");

        vm.prank(user);
        vm.expectRevert("SOFPaymaster: not EntryPoint");
        paymaster.validatePaymasterUserOp(userOp, keccak256("x"), 0);
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
