// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFSmartAccountFactory} from "src/account/SOFSmartAccountFactory.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";

/// @title SOFSmartAccountFactoryTest
/// @notice Unit tests for the CREATE2 factory that deploys per-EOA
///         SOFSmartAccount instances. TDD-first: these tests are written
///         before the factory itself (Task 1.6) and must fail to compile
///         until the factory contract exists.
/// @dev Verifies:
///      - getAddress(eoa) is deterministic
///      - getAddress differs per owner
///      - createAccount deploys at the predicted address
///      - createAccount is idempotent (same EOA → same SMA)
///      - createAccount emits AccountCreated(owner, account) on first deploy
contract SOFSmartAccountFactoryTest is Test {
    SOFSmartAccountFactory factory;
    address eoa = address(0xCAFE);

    function setUp() public {
        factory = new SOFSmartAccountFactory();
    }

    function test_getAddress_isDeterministic() public view {
        address a = factory.getAddress(eoa);
        address b = factory.getAddress(eoa);
        assertEq(a, b);
    }

    function test_getAddress_differsByOwner() public view {
        address a = factory.getAddress(eoa);
        address b = factory.getAddress(address(0xBEEF));
        assertTrue(a != b);
    }

    function test_createAccount_deploysAtPredictedAddress() public {
        address predicted = factory.getAddress(eoa);
        assertEq(predicted.code.length, 0); // not yet deployed
        SOFSmartAccount account = factory.createAccount(eoa);
        assertEq(address(account), predicted);
        assertTrue(predicted.code.length > 0);
        // SignerECDSA exposes the stored signer via signer().
        assertEq(account.signer(), eoa);
    }

    function test_createAccount_isIdempotent() public {
        SOFSmartAccount first = factory.createAccount(eoa);
        SOFSmartAccount second = factory.createAccount(eoa);
        assertEq(address(first), address(second));
    }

    function test_createAccount_emitsAccountCreated() public {
        address predicted = factory.getAddress(eoa);
        vm.expectEmit(true, true, false, false);
        emit SOFSmartAccountFactory.AccountCreated(eoa, predicted);
        factory.createAccount(eoa);
    }
}
