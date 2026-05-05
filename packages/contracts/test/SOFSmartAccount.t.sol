// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {ERC7739Utils} from "@openzeppelin/contracts/utils/cryptography/draft-ERC7739Utils.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @title SOFSmartAccountTest
/// @notice Unit tests for the rewritten counterfactual ERC-4337 v0.8 account.
/// @dev Verifies the composition of OZ's audited mixins:
///      - {Account} for ERC-4337 validation flow.
///      - {SignerECDSA} for stored-signer ECDSA recovery.
///      - {ERC7739} for nested EIP-712 ERC-1271 signature validation.
///      - {ERC7821} for batched execute.
contract SOFSmartAccountTest is Test {
    using MessageHashUtils for bytes32;

    bytes4 internal constant ERC1271_MAGIC = IERC1271.isValidSignature.selector; // 0x1626ba7e

    /// @dev ERC-7821 single-batch mode: callType 0x01 in the high byte, all other fields zero.
    bytes32 internal constant ERC7821_BATCH_MODE =
        bytes32(hex"0100000000000000000000000000000000000000000000000000000000000000");

    SOFSmartAccount internal account;
    Vm.Wallet internal ownerWallet;
    address internal owner;

    function setUp() public {
        ownerWallet = vm.createWallet("owner");
        owner = ownerWallet.addr;
        // Deploy the account directly. The factory's CREATE2 path is exercised
        // separately in SOFSmartAccountFactory.t.sol. The Account base
        // hard-codes the canonical v0.8 EntryPoint via a virtual; tests prank
        // as `account.entryPoint()` rather than mocking the EntryPoint.
        account = new SOFSmartAccount(owner);
    }

    // ──────────────────────────────────────────────────────────────────
    // signer() public accessor
    // ──────────────────────────────────────────────────────────────────

    function test_signer_returnsConstructorArgument() public view {
        assertEq(account.signer(), owner);
    }

    // ──────────────────────────────────────────────────────────────────
    // eip712Domain()
    // ──────────────────────────────────────────────────────────────────

    function test_eip712Domain_matchesSpec() public view {
        (
            ,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            ,
        ) = account.eip712Domain();
        assertEq(name, "SOF Smart Account");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(account));
    }

    // ──────────────────────────────────────────────────────────────────
    // ERC-1271 isValidSignature — ERC-7739 nested typed data path
    // ──────────────────────────────────────────────────────────────────

    function test_isValidSignature_ownerErc7739TypedData_returnsMagicValue() public view {
        bytes32 contentsHash = keccak256("contents");
        bytes32 appSeparator = _appDomainSeparator();
        bytes32 hash = appSeparator.toTypedDataHash(contentsHash);

        bytes memory sig = _signErc7739TypedData(ownerWallet, appSeparator, contentsHash);
        bytes4 magic = account.isValidSignature(hash, sig);
        assertEq(magic, ERC1271_MAGIC);
    }

    function test_isValidSignature_nonOwnerErc7739TypedData_returnsFailure() public {
        Vm.Wallet memory attacker = vm.createWallet("attacker");
        bytes32 contentsHash = keccak256("contents");
        bytes32 appSeparator = _appDomainSeparator();
        bytes32 hash = appSeparator.toTypedDataHash(contentsHash);

        bytes memory sig = _signErc7739TypedData(attacker, appSeparator, contentsHash);
        bytes4 magic = account.isValidSignature(hash, sig);
        assertTrue(magic != ERC1271_MAGIC);
    }

    // ──────────────────────────────────────────────────────────────────
    // ERC-1271 isValidSignature — ERC-7739 nested personal-sign path
    // ──────────────────────────────────────────────────────────────────

    function test_isValidSignature_ownerErc7739PersonalSign_returnsMagicValue() public view {
        bytes32 hash = keccak256("personal message");
        bytes memory sig = _signErc7739PersonalSign(ownerWallet, hash);
        bytes4 magic = account.isValidSignature(hash, sig);
        assertEq(magic, ERC1271_MAGIC);
    }

    function test_isValidSignature_nonOwnerErc7739PersonalSign_returnsFailure() public {
        Vm.Wallet memory attacker = vm.createWallet("attacker");
        bytes32 hash = keccak256("personal message");
        bytes memory sig = _signErc7739PersonalSign(attacker, hash);
        bytes4 magic = account.isValidSignature(hash, sig);
        assertTrue(magic != ERC1271_MAGIC);
    }

    // ──────────────────────────────────────────────────────────────────
    // ERC-4337 validateUserOp
    // ──────────────────────────────────────────────────────────────────

    /// @dev EntryPoint v0.8 produces an EIP-712 typed-data `userOpHash` natively, so
    /// `Account._signableUserOpHash` returns it unchanged and SignerECDSA recovers
    /// directly against the raw `userOpHash`. No ERC-7739 wrap is applied here.
    function test_validateUserOp_ownerSignature_returnsSuccess() public {
        bytes32 userOpHash = keccak256("test op");
        bytes memory sig = _signRaw(ownerWallet, userOpHash);
        PackedUserOperation memory op = _packedOp(sig);

        vm.prank(address(account.entryPoint()));
        uint256 validation = account.validateUserOp(op, userOpHash, 0);
        assertEq(validation, 0); // SIG_VALIDATION_SUCCESS
    }

    function test_validateUserOp_nonOwnerSignature_returnsFailure() public {
        Vm.Wallet memory attacker = vm.createWallet("attacker");
        bytes32 userOpHash = keccak256("test op");
        bytes memory sig = _signRaw(attacker, userOpHash);
        PackedUserOperation memory op = _packedOp(sig);

        vm.prank(address(account.entryPoint()));
        uint256 validation = account.validateUserOp(op, userOpHash, 0);
        assertEq(validation, 1); // SIG_VALIDATION_FAILED
    }

    function test_validateUserOp_revertsWhenCallerNotEntryPoint() public {
        bytes32 userOpHash = keccak256("test op");
        bytes memory sig = _signRaw(ownerWallet, userOpHash);
        PackedUserOperation memory op = _packedOp(sig);

        vm.expectRevert();
        account.validateUserOp(op, userOpHash, 0);
    }

    // ──────────────────────────────────────────────────────────────────
    // ERC-7821 batched execute via EntryPoint
    // ──────────────────────────────────────────────────────────────────

    function test_execute_batchedCallsViaEntryPoint_executesAll() public {
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution({target: address(this), value: 0, callData: abi.encodeWithSignature("noop()")});
        calls[1] = Execution({target: address(this), value: 0, callData: abi.encodeWithSignature("noop()")});
        bytes memory executionData = abi.encode(calls);

        vm.prank(address(account.entryPoint()));
        account.execute(ERC7821_BATCH_MODE, executionData);
        assertEq(noopCount, 2);
    }

    function test_execute_revertsWhenCallerUnauthorized() public {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution({target: address(this), value: 0, callData: abi.encodeWithSignature("noop()")});
        bytes memory executionData = abi.encode(calls);

        vm.expectRevert();
        vm.prank(address(0xBEEF));
        account.execute(ERC7821_BATCH_MODE, executionData);
    }

    // ──────────────────────────────────────────────────────────────────
    // Test fixture state and helpers
    // ──────────────────────────────────────────────────────────────────

    uint256 internal noopCount;

    function noop() external {
        noopCount++;
    }

    receive() external payable {}

    /// @dev Build the SOFSmartAccount's own EIP-712 domain separator (no salt).
    function _accountDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("SOF Smart Account")),
                keccak256(bytes("1")),
                block.chainid,
                address(account)
            )
        );
    }

    /// @dev A dummy app-level domain separator. Mirrors the helper used by
    /// OpenZeppelin's own ERC-7739 test suite (see lib/openzeppelin-contracts/
    /// test/utils/cryptography/ERC1271.behavior.js — `appDomain`). The hash is
    /// arbitrary; the only requirement is that the signature commits to the
    /// same separator that the test passes through to ERC-7739.
    function _appDomainSeparator() internal pure returns (bytes32) {
        return keccak256("SOFSmartAccountTest:appDomainSeparator");
    }

    /// @dev Build an ERC-7739 nested-typed-data signature.
    /// Encoding: `signature || appSeparator || contentsHash || contentsDescr || uint16(len)`.
    /// We use the implicit-mode descriptor `Contents(bytes32 hash)Contents` (single type,
    /// name parsed from the prefix). The full domain bytes (per ERC-7739) include the
    /// account's name, version, chainId, verifyingContract, and salt = 0.
    function _signErc7739TypedData(
        Vm.Wallet memory w,
        bytes32 appSeparator,
        bytes32 contentsHash
    ) internal view returns (bytes memory) {
        // Build the contentsDescr: "Contents(bytes32 hash)" (implicit form — descr ends with ')').
        string memory contentsDescr = "Contents(bytes32 hash)";

        // typedDataSignTypehash(contentsName="Contents", contentsType="Contents(bytes32 hash)") =
        //   keccak256("TypedDataSign(Contents contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)Contents(bytes32 hash)")
        bytes32 typedDataSignTypehash = keccak256(
            abi.encodePacked(
                "TypedDataSign(",
                "Contents",
                " contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)",
                "Contents(bytes32 hash)"
            )
        );

        // Domain bytes = abi.encode(keccak256(name), keccak256(version), chainId, verifyingContract, salt).
        bytes memory domainBytes = abi.encode(
            keccak256(bytes("SOF Smart Account")),
            keccak256(bytes("1")),
            block.chainid,
            address(account),
            bytes32(0)
        );

        // Reconstruct the same struct hash that ERC7739Utils.typedDataSignStructHash builds.
        bytes32 structHash = keccak256(abi.encodePacked(typedDataSignTypehash, contentsHash, domainBytes));

        // The digest the ERC-7739 contract recovers against:
        //   appSeparator.toTypedDataHash(structHash) == keccak256("\x19\x01" || appSeparator || structHash)
        bytes32 digest = appSeparator.toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, digest);
        bytes memory rsv = abi.encodePacked(r, s, v);

        return ERC7739Utils.encodeTypedDataSig(rsv, appSeparator, contentsHash, contentsDescr);
    }

    /// @dev Build an ERC-7739 nested-personal-sign signature.
    /// ERC-7739 verifies:
    ///   _domainSeparatorV4().toTypedDataHash(personalSignStructHash(hash))
    /// where personalSignStructHash(hash) = keccak256(abi.encode(PERSONAL_SIGN_TYPEHASH, hash)).
    /// The PersonalSign nested struct uses the account's own EIP-712 domain (no app domain).
    function _signErc7739PersonalSign(
        Vm.Wallet memory w,
        bytes32 hash
    ) internal view returns (bytes memory) {
        bytes32 personalSignTypehash = keccak256("PersonalSign(bytes prefixed)");
        bytes32 structHash = keccak256(abi.encode(personalSignTypehash, hash));
        bytes32 digest = _accountDomainSeparator().toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Plain ECDSA over the raw hash — used by validateUserOp's
    /// SignerECDSA._rawSignatureValidation path.
    function _signRaw(Vm.Wallet memory w, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, hash);
        return abi.encodePacked(r, s, v);
    }

    function _packedOp(bytes memory sig) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = 0;
        op.initCode = "";
        op.callData = "";
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 0;
        op.gasFees = bytes32(0);
        op.paymasterAndData = "";
        op.signature = sig;
    }
}
