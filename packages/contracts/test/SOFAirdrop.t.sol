// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/airdrop/SOFAirdrop.sol";
import "../src/token/SOFToken.sol";

contract SOFAirdropTest is Test {
    SOFToken public token;
    SOFAirdrop public airdrop;

    address public admin;
    address public attestor;
    uint256 public attestorKey;
    address public user;
    address public relayer;

    uint256 public constant INITIAL_AMOUNT = 10_000 ether;
    uint256 public constant BASIC_AMOUNT = 5_000 ether;
    uint256 public constant DAILY_AMOUNT = 1_000 ether;
    uint256 public constant COOLDOWN = 86400; // 1 day
    uint256 public constant FID = 12345;

    bytes32 private constant FARCASTER_ATTESTATION_TYPEHASH =
        keccak256("FarcasterAttestation(address wallet,uint256 fid,uint256 deadline)");

    event InitialClaimed(address indexed user, uint256 amount, bool farcasterVerified);
    event DailyClaimed(address indexed user, uint256 amount);

    function setUp() public {
        admin = address(this);
        (attestor, attestorKey) = makeAddrAndKey("attestor");
        user = makeAddr("user");
        relayer = makeAddr("relayer");

        // Deploy SOFToken with zero initial supply (airdrop mints on demand)
        token = new SOFToken("SOF Token", "SOF", 0);

        // Deploy SOFAirdrop
        airdrop = new SOFAirdrop(
            address(token),
            attestor,
            INITIAL_AMOUNT,
            BASIC_AMOUNT,
            DAILY_AMOUNT,
            COOLDOWN
        );

        // Grant MINTER_ROLE to airdrop contract
        token.grantRole(token.MINTER_ROLE(), address(airdrop));

        // Grant RELAYER_ROLE to relayer
        airdrop.grantRole(airdrop.RELAYER_ROLE(), relayer);
    }

    // ============ Helpers ============

    function _signAttestation(
        uint256 pk,
        address wallet,
        uint256 fid,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(FARCASTER_ATTESTATION_TYPEHASH, wallet, fid, deadline)
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SecondOrder.fun SOFAirdrop"),
                keccak256("1"),
                block.chainid,
                address(airdrop)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // ============ Tests ============

    function test_claimInitial() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit InitialClaimed(user, INITIAL_AMOUNT, true);
        airdrop.claimInitial(FID, deadline, v, r, s);

        assertTrue(airdrop.hasClaimed(user));
        assertEq(token.balanceOf(user), INITIAL_AMOUNT);
    }

    function test_revert_claimInitialTwice() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.startPrank(user);
        airdrop.claimInitial(FID, deadline, v, r, s);

        vm.expectRevert(SOFAirdrop.AlreadyClaimed.selector);
        airdrop.claimInitial(FID, deadline, v, r, s);
        vm.stopPrank();
    }

    function test_claimDaily() public {
        // First do initial claim
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(user);
        airdrop.claimInitial(FID, deadline, v, r, s);

        // Daily claim should work immediately (no previous daily claim)
        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit DailyClaimed(user, DAILY_AMOUNT);
        airdrop.claimDaily();

        assertEq(token.balanceOf(user), INITIAL_AMOUNT + DAILY_AMOUNT);
    }

    function test_revert_dailyBeforeInitial() public {
        vm.prank(user);
        vm.expectRevert(SOFAirdrop.AlreadyClaimed.selector);
        airdrop.claimDaily();
    }

    function test_revert_dailyCooldown() public {
        // Initial claim
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(user);
        airdrop.claimInitial(FID, deadline, v, r, s);

        // First daily claim
        vm.prank(user);
        airdrop.claimDaily();

        // Second daily claim too soon
        vm.prank(user);
        uint256 nextClaimAt = block.timestamp + COOLDOWN;
        vm.expectRevert(abi.encodeWithSelector(SOFAirdrop.CooldownNotElapsed.selector, nextClaimAt));
        airdrop.claimDaily();
    }

    function test_dailyAfterCooldown() public {
        // Initial claim
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(user);
        airdrop.claimInitial(FID, deadline, v, r, s);

        // First daily claim
        vm.prank(user);
        airdrop.claimDaily();

        // Warp past cooldown
        vm.warp(block.timestamp + COOLDOWN + 1);

        // Second daily claim should succeed
        vm.prank(user);
        airdrop.claimDaily();

        assertEq(token.balanceOf(user), INITIAL_AMOUNT + 2 * DAILY_AMOUNT);
    }

    function test_revert_expiredAttestation() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(user);
        vm.expectRevert(SOFAirdrop.AttestationExpired.selector);
        airdrop.claimInitial(FID, deadline, v, r, s);
    }

    function test_revert_wrongAttestor() public {
        (, uint256 wrongKey) = makeAddrAndKey("wrong");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(wrongKey, user, FID, deadline);

        vm.prank(user);
        vm.expectRevert(SOFAirdrop.InvalidAttestor.selector);
        airdrop.claimInitial(FID, deadline, v, r, s);
    }

    function test_claimInitialBasic() public {
        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit InitialClaimed(user, BASIC_AMOUNT, false);
        airdrop.claimInitialBasic();

        assertTrue(airdrop.hasClaimed(user));
        assertEq(token.balanceOf(user), BASIC_AMOUNT);
    }

    function test_revert_basicThenFarcaster() public {
        // Claim basic first
        vm.prank(user);
        airdrop.claimInitialBasic();

        // Try Farcaster claim — should revert
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(user);
        vm.expectRevert(SOFAirdrop.AlreadyClaimed.selector);
        airdrop.claimInitial(FID, deadline, v, r, s);
    }

    function test_revert_basicClaimTwice() public {
        vm.startPrank(user);
        airdrop.claimInitialBasic();

        vm.expectRevert(SOFAirdrop.AlreadyClaimed.selector);
        airdrop.claimInitialBasic();
        vm.stopPrank();
    }

    function test_dailyAfterBasicClaim() public {
        // Basic claim first
        vm.prank(user);
        airdrop.claimInitialBasic();

        // Daily claim should work
        vm.prank(user);
        airdrop.claimDaily();

        assertEq(token.balanceOf(user), BASIC_AMOUNT + DAILY_AMOUNT);
    }

    function test_adminSetAmounts() public {
        uint256 newInitial = 20_000 ether;
        uint256 newBasic = 8_000 ether;
        uint256 newDaily = 2_000 ether;

        airdrop.setAmounts(newInitial, newBasic, newDaily);

        assertEq(airdrop.initialAmount(), newInitial);
        assertEq(airdrop.basicAmount(), newBasic);
        assertEq(airdrop.dailyAmount(), newDaily);
    }

    function test_adminSetCooldown() public {
        uint256 newCooldown = 43200; // 12 hours

        airdrop.setCooldown(newCooldown);

        assertEq(airdrop.cooldown(), newCooldown);
    }

    // ============ Relayer Tests ============

    function test_relayerClaimInitialFor() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(relayer);
        vm.expectEmit(true, false, false, true);
        emit InitialClaimed(user, INITIAL_AMOUNT, true);
        airdrop.claimInitialFor(user, FID, deadline, v, r, s);

        assertTrue(airdrop.hasClaimed(user));
        assertEq(token.balanceOf(user), INITIAL_AMOUNT);
        // Relayer should not have any tokens
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_revert_unauthorizedRelayer() public {
        address unauthorized = makeAddr("unauthorized");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(unauthorized);
        vm.expectRevert();
        airdrop.claimInitialFor(user, FID, deadline, v, r, s);
    }

    function test_revert_relayerClaimInitialForAlreadyClaimed() public {
        // User claims directly first
        vm.prank(user);
        airdrop.claimInitialBasic();

        // Relayer tries to claim for same user
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, user, FID, deadline);

        vm.prank(relayer);
        vm.expectRevert(SOFAirdrop.AlreadyClaimed.selector);
        airdrop.claimInitialFor(user, FID, deadline, v, r, s);
    }

    function test_revert_relayerClaimInitialForZeroAddress() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAttestation(attestorKey, address(0), FID, deadline);

        vm.prank(relayer);
        vm.expectRevert(SOFAirdrop.ZeroAddress.selector);
        airdrop.claimInitialFor(address(0), FID, deadline, v, r, s);
    }

    function test_relayerClaimInitialBasicFor() public {
        vm.prank(relayer);
        vm.expectEmit(true, false, false, true);
        emit InitialClaimed(user, BASIC_AMOUNT, false);
        airdrop.claimInitialBasicFor(user);

        assertTrue(airdrop.hasClaimed(user));
        assertEq(token.balanceOf(user), BASIC_AMOUNT);
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_revert_relayerBasicForZeroAddress() public {
        vm.prank(relayer);
        vm.expectRevert(SOFAirdrop.ZeroAddress.selector);
        airdrop.claimInitialBasicFor(address(0));
    }

    function test_relayerClaimDailyFor() public {
        // User must have initial claim first
        vm.prank(relayer);
        airdrop.claimInitialBasicFor(user);

        // Relayer claims daily for user
        vm.prank(relayer);
        vm.expectEmit(true, false, false, true);
        emit DailyClaimed(user, DAILY_AMOUNT);
        airdrop.claimDailyFor(user);

        assertEq(token.balanceOf(user), BASIC_AMOUNT + DAILY_AMOUNT);
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_revert_relayerDailyForCooldown() public {
        // Initial claim
        vm.prank(relayer);
        airdrop.claimInitialBasicFor(user);

        // First daily
        vm.prank(relayer);
        airdrop.claimDailyFor(user);

        // Second daily too soon
        vm.prank(relayer);
        uint256 nextClaimAt = block.timestamp + COOLDOWN;
        vm.expectRevert(abi.encodeWithSelector(SOFAirdrop.CooldownNotElapsed.selector, nextClaimAt));
        airdrop.claimDailyFor(user);
    }

    function test_revert_relayerDailyForNoInitialClaim() public {
        vm.prank(relayer);
        vm.expectRevert(SOFAirdrop.AlreadyClaimed.selector);
        airdrop.claimDailyFor(user);
    }
}
