// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFPaymaster} from "src/paymaster/SOFPaymaster.sol";
import {SOFSmartAccountFactory} from "src/account/SOFSmartAccountFactory.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";
import {Raffle} from "src/core/Raffle.sol";
import {SOFToken} from "src/token/SOFToken.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";

/// @title SOFPaymasterTest
/// @notice TDD red-phase tests for the rewritten SOFPaymaster (Task 1.11).
/// @dev    Per spec §3.3, the paymaster sponsors UserOps where:
///           1. `sender` is a SOFSmartAccount the factory would have deployed
///              for `SOFSmartAccount(sender).signer()` (factory-counterfactual
///              identity). Reads `factory.getAddress(account.signer())` and
///              compares to `sender`.
///           2. Every call target inside the user's batched callData is in the
///              static allowlist OR `raffle.isSofCurve(target) == true`.
///         The new constructor signature is:
///           `(address _entryPoint, address _factory, address _raffle, address[] memory initialAllowlist)`.
///         These tests will not compile/run successfully until Task 1.11
///         rewrites SOFPaymaster.sol — that is the desired TDD red state.
contract SOFPaymasterTest is Test {
    /// @dev ERC-7821 single batch mode: CallType 0x01 in the high byte, all
    ///      other bytes zero. This is the only mode OZ ERC7821 supports.
    bytes32 internal constant ERC7821_BATCH_MODE =
        bytes32(hex"0100000000000000000000000000000000000000000000000000000000000000");

    SOFPaymaster internal paymaster;
    SOFSmartAccountFactory internal factory;
    Raffle internal raffle;
    SOFToken internal sof;

    /// @dev EntryPoint stand-in. The new paymaster only requires that
    ///      `validatePaymasterUserOp` reverts unless `msg.sender == entryPoint`,
    ///      so we don't need a real EntryPoint contract here.
    address internal entryPoint = address(0xEEEE);

    address internal constant EOA_OWNER = address(0x0E0A);
    address internal constant RANDOM_CURVE = address(0xBADC0DE);
    address internal constant NON_ALLOWLISTED_TARGET = address(0xBEEF);
    address internal constant VRF_COORDINATOR_PLACEHOLDER = address(0xC00D);

    function setUp() public {
        // Real SOFToken so allowlist entries are non-zero, real addresses.
        sof = new SOFToken("SecondOrder Fun Token", "SOF", 1_000_000 ether);

        // Real Raffle so we can exercise registerCurve / isSofCurve. The mock
        // VRF coordinator address is fine — the paymaster path doesn't touch
        // VRF. Pattern mirrors test/SeasonFactoryRollover.t.sol:28.
        raffle = new Raffle(address(sof), VRF_COORDINATOR_PLACEHOLDER, 0, bytes32(0));

        factory = new SOFSmartAccountFactory();

        address[] memory initialAllowlist = new address[](2);
        initialAllowlist[0] = address(raffle);
        initialAllowlist[1] = address(sof);

        paymaster = new SOFPaymaster(
            entryPoint,
            address(factory),
            address(raffle),
            initialAllowlist
        );
    }

    // ──────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────

    /// @dev Build the SMA's outer callData for a single-target inner call by
    ///      wrapping it in a 1-element ERC-7821 batch. OZ ERC7821 only
    ///      supports batch mode, so even a "single call" must be encoded as
    ///      `Execution[]` of length 1.
    function _singleCallBatch(address target) internal pure returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution({target: target, value: 0, callData: ""});
        return abi.encodeCall(ERC7821.execute, (ERC7821_BATCH_MODE, abi.encode(calls)));
    }

    /// @dev Build the SMA's outer callData for an N-target ERC-7821 batch.
    function _multiCallBatch(address[] memory targets) internal pure returns (bytes memory) {
        Execution[] memory calls = new Execution[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            calls[i] = Execution({target: targets[i], value: 0, callData: ""});
        }
        return abi.encodeCall(ERC7821.execute, (ERC7821_BATCH_MODE, abi.encode(calls)));
    }

    /// @dev Build a minimal PackedUserOperation. The paymaster only inspects
    ///      `sender` and `callData`; the rest can be zeroed.
    function _userOp(address sender, bytes memory callData)
        internal
        pure
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.callData = callData;
        // All other fields default to their zero values.
    }

    // ──────────────────────────────────────────────────────────────────
    // Tests
    // ──────────────────────────────────────────────────────────────────

    /// @notice Sender deployed via factory + only target is in static allowlist
    ///         → paymaster returns SIG_VALIDATION_SUCCESS (validationData == 0).
    function test_sponsorsAllowlistedTarget() public {
        SOFSmartAccount account = factory.createAccount(EOA_OWNER);

        bytes memory callData = _singleCallBatch(address(sof));
        PackedUserOperation memory op = _userOp(address(account), callData);

        vm.prank(entryPoint);
        (bytes memory ctx, uint256 validationData) =
            paymaster.validatePaymasterUserOp(op, bytes32(0), 0);

        assertEq(validationData, 0, "validationData should be 0 for allowlisted target");
        assertEq(ctx.length, 0, "context should be empty");
    }

    /// @notice Sender deployed via factory + target is registered as a sofCurve
    ///         → paymaster returns SIG_VALIDATION_SUCCESS.
    function test_sponsorsRegisteredCurve() public {
        // Test contract holds DEFAULT_ADMIN_ROLE on raffle (it deployed it),
        // so it can grant SEASON_FACTORY_ROLE to itself and call registerCurve.
        raffle.grantRole(raffle.SEASON_FACTORY_ROLE(), address(this));
        raffle.registerCurve(RANDOM_CURVE);
        assertTrue(raffle.isSofCurve(RANDOM_CURVE), "precondition: curve should be registered");

        SOFSmartAccount account = factory.createAccount(EOA_OWNER);

        bytes memory callData = _singleCallBatch(RANDOM_CURVE);
        PackedUserOperation memory op = _userOp(address(account), callData);

        vm.prank(entryPoint);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(op, bytes32(0), 0);

        assertEq(validationData, 0, "validationData should be 0 for registered curve");
    }

    /// @notice Sender is a SOFSmartAccount NOT deployed via the factory
    ///         (direct `new` deploy) → factory.getAddress(signer) doesn't match
    ///         sender → paymaster reverts.
    function test_rejectsNonFactorySender() public {
        // Direct deploy of a SOFSmartAccount — its address is NOT the CREATE2
        // address the factory would produce for `EOA_OWNER`.
        SOFSmartAccount fake = new SOFSmartAccount(EOA_OWNER);
        // Sanity check: confirm addresses differ so the paymaster check is meaningful.
        assertTrue(
            address(fake) != factory.getAddress(EOA_OWNER),
            "precondition: directly-deployed account address must differ from factory's CREATE2 address"
        );

        bytes memory callData = _singleCallBatch(address(sof));
        PackedUserOperation memory op = _userOp(address(fake), callData);

        vm.prank(entryPoint);
        // Per plan Task 1.11 stub: paymaster reverts with NotFactoryAccount()
        // when factory.getAddress(account.signer()) != sender. Typed expect so
        // the test fails loudly if Task 1.11 reverts via some unrelated path.
        vm.expectRevert(SOFPaymaster.NotFactoryAccount.selector);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    /// @notice Sender deployed via factory but target is neither in static
    ///         allowlist nor a registered curve → paymaster reverts with
    ///         `TargetNotAllowed(target)`.
    function test_rejectsNonAllowlistedTarget() public {
        SOFSmartAccount account = factory.createAccount(EOA_OWNER);

        bytes memory callData = _singleCallBatch(NON_ALLOWLISTED_TARGET);
        PackedUserOperation memory op = _userOp(address(account), callData);

        vm.prank(entryPoint);
        vm.expectRevert(
            abi.encodeWithSignature("TargetNotAllowed(address)", NON_ALLOWLISTED_TARGET)
        );
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    /// @notice In a multi-call ERC-7821 batch, every inner call's target must
    ///         pass the allowlist/sofCurve check. If even one is non-allowed,
    ///         paymaster reverts. Specifically: call[0] is allowlisted, call[1]
    ///         is not → revert.
    function test_validatesAllInnerCalls_inExecuteBatch() public {
        SOFSmartAccount account = factory.createAccount(EOA_OWNER);

        address[] memory targets = new address[](2);
        targets[0] = address(sof); // allowlisted
        targets[1] = NON_ALLOWLISTED_TARGET; // NOT allowlisted, NOT a curve

        bytes memory callData = _multiCallBatch(targets);
        PackedUserOperation memory op = _userOp(address(account), callData);

        vm.prank(entryPoint);
        vm.expectRevert(
            abi.encodeWithSignature("TargetNotAllowed(address)", NON_ALLOWLISTED_TARGET)
        );
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }
}
