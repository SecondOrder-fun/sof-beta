// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../src/gating/SeasonGating.sol";
import "../src/gating/ISeasonGating.sol";

contract SeasonGatingTest is Test {
    SeasonGating public gating;

    address public admin = address(0x1);
    address public raffleContract = address(0x2);
    address public user1 = address(0x3);
    address public user2 = address(0x4);

    uint256 public constant SEASON_ID = 1;
    string public constant TEST_PASSWORD = "secret123";

    event GatesConfigured(uint256 indexed seasonId, uint256 gateCount);
    event UserVerified(uint256 indexed seasonId, uint256 indexed gateIndex, address indexed user, ISeasonGating.GateType gateType);
    event GateAdded(uint256 indexed seasonId, uint256 gateIndex, ISeasonGating.GateType gateType);

    function setUp() public {
        vm.startPrank(admin);
        gating = new SeasonGating(admin, raffleContract);
        vm.stopPrank();
    }

    // ============ Constructor Tests ============

    function testConstructorSetsRoles() public view {
        assertTrue(gating.hasRole(gating.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(gating.hasRole(gating.GATE_ADMIN_ROLE(), admin));
        assertTrue(gating.hasRole(gating.GATE_ADMIN_ROLE(), raffleContract));
        assertEq(gating.raffleContract(), raffleContract);
    }

    function testConstructorRevertsOnZeroAdmin() public {
        vm.expectRevert(ISeasonGating.Unauthorized.selector);
        new SeasonGating(address(0), raffleContract);
    }

    function testConstructorWithZeroRaffleContract() public {
        SeasonGating g = new SeasonGating(admin, address(0));
        assertEq(g.raffleContract(), address(0));
        assertFalse(g.hasRole(g.GATE_ADMIN_ROLE(), address(0)));
    }

    // ============ Configure Gates Tests ============

    function testConfigureGatesSuccess() public {
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit GateAdded(SEASON_ID, 0, ISeasonGating.GateType.PASSWORD);
        vm.expectEmit(true, false, false, true);
        emit GatesConfigured(SEASON_ID, 1);
        gating.configureGates(SEASON_ID, gates);

        ISeasonGating.GateConfig[] memory retrievedGates = gating.getSeasonGates(SEASON_ID);
        assertEq(retrievedGates.length, 1);
        assertEq(uint8(retrievedGates[0].gateType), uint8(ISeasonGating.GateType.PASSWORD));
        assertTrue(retrievedGates[0].enabled);
    }

    function testConfigureGatesRevertsOnInvalidSeasonId() public {
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        vm.expectRevert(ISeasonGating.InvalidSeasonId.selector);
        gating.configureGates(0, gates);
    }

    function testConfigureGatesReplacesExisting() public {
        // Configure initial gates
        ISeasonGating.GateConfig[] memory gates1 = new ISeasonGating.GateConfig[](2);
        gates1[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("password1"))
        });
        gates1[1] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("password2"))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates1);
        assertEq(gating.getGateCount(SEASON_ID), 2);

        // Configure new gates (should replace)
        ISeasonGating.GateConfig[] memory gates2 = new ISeasonGating.GateConfig[](1);
        gates2[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("newpassword"))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates2);
        assertEq(gating.getGateCount(SEASON_ID), 1);
    }

    function testConfigureGatesOnlyGateAdmin() public {
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(user1);
        vm.expectRevert();
        gating.configureGates(SEASON_ID, gates);
    }

    // ============ Password Verification Tests ============

    function testVerifyPasswordSuccess() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // Verify password
        vm.prank(user1);
        vm.expectEmit(true, true, true, true);
        emit UserVerified(SEASON_ID, 0, user1, ISeasonGating.GateType.PASSWORD);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);

        assertTrue(gating.isGateVerified(SEASON_ID, 0, user1));
        assertTrue(gating.isUserVerified(SEASON_ID, user1));
    }

    function testVerifyPasswordRevertsOnInvalidPassword() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // Try wrong password
        vm.prank(user1);
        vm.expectRevert(ISeasonGating.InvalidPassword.selector);
        gating.verifyPassword(SEASON_ID, 0, "wrongpassword");

        assertFalse(gating.isGateVerified(SEASON_ID, 0, user1));
    }

    function testVerifyPasswordRevertsOnEmptyPassword() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // Try empty password
        vm.prank(user1);
        vm.expectRevert(ISeasonGating.EmptyPassword.selector);
        gating.verifyPassword(SEASON_ID, 0, "");
    }

    function testVerifyPasswordRevertsOnAlreadyVerified() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // Verify first time
        vm.prank(user1);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);

        // Try to verify again
        vm.prank(user1);
        vm.expectRevert(ISeasonGating.AlreadyVerified.selector);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);
    }

    function testVerifyPasswordRevertsOnDisabledGate() public {
        // Setup disabled gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: false,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        vm.prank(user1);
        vm.expectRevert(ISeasonGating.GateNotEnabled.selector);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);
    }

    function testVerifyPasswordRevertsOnInvalidGateIndex() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        vm.prank(user1);
        vm.expectRevert(ISeasonGating.InvalidGateIndex.selector);
        gating.verifyPassword(SEASON_ID, 1, TEST_PASSWORD); // Index 1 doesn't exist
    }

    function testVerifyPasswordRevertsOnGateTypeMismatch() public {
        // Setup ALLOWLIST gate instead of PASSWORD
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.ALLOWLIST,
            enabled: true,
            configHash: bytes32(0) // Merkle root placeholder
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        vm.prank(user1);
        vm.expectRevert(ISeasonGating.GateTypeMismatch.selector);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);
    }

    // ============ AND Logic Tests ============

    function testMultipleGatesANDLogic() public {
        // Setup two password gates
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](2);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("password1"))
        });
        gates[1] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("password2"))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // User not verified before any verification
        assertFalse(gating.isUserVerified(SEASON_ID, user1));

        // Verify first password
        vm.prank(user1);
        gating.verifyPassword(SEASON_ID, 0, "password1");

        // User still not fully verified (only one gate passed)
        assertFalse(gating.isUserVerified(SEASON_ID, user1));
        assertTrue(gating.isGateVerified(SEASON_ID, 0, user1));
        assertFalse(gating.isGateVerified(SEASON_ID, 1, user1));

        // Verify second password
        vm.prank(user1);
        gating.verifyPassword(SEASON_ID, 1, "password2");

        // Now user is fully verified (both gates passed)
        assertTrue(gating.isUserVerified(SEASON_ID, user1));
        assertTrue(gating.isGateVerified(SEASON_ID, 0, user1));
        assertTrue(gating.isGateVerified(SEASON_ID, 1, user1));
    }

    function testMixedEnabledDisabledGates() public {
        // Setup one enabled and one disabled gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](2);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("password1"))
        });
        gates[1] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: false, // Disabled
            configHash: keccak256(abi.encodePacked("password2"))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // Verify first password
        vm.prank(user1);
        gating.verifyPassword(SEASON_ID, 0, "password1");

        // User is verified because disabled gates are skipped
        assertTrue(gating.isUserVerified(SEASON_ID, user1));
    }

    // ============ No Gates Configured Tests ============

    function testNoGatesConfiguredMeansVerified() public view {
        // No gates configured for season 2
        assertTrue(gating.isUserVerified(2, user1));
    }

    function testEmptyGatesArrayMeansVerified() public {
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](0);

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        assertTrue(gating.isUserVerified(SEASON_ID, user1));
    }

    // ============ Clear Gates Tests ============

    function testClearGates() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);
        assertEq(gating.getGateCount(SEASON_ID), 1);

        // Clear gates
        vm.prank(admin);
        gating.clearGates(SEASON_ID);
        assertEq(gating.getGateCount(SEASON_ID), 0);
        assertTrue(gating.isUserVerified(SEASON_ID, user1)); // No gates = verified
    }

    // ============ Set Raffle Contract Tests ============

    function testSetRaffleContract() public {
        address newRaffle = address(0x5);

        vm.prank(admin);
        gating.setRaffleContract(newRaffle);

        assertEq(gating.raffleContract(), newRaffle);
        assertTrue(gating.hasRole(gating.GATE_ADMIN_ROLE(), newRaffle));
        assertFalse(gating.hasRole(gating.GATE_ADMIN_ROLE(), raffleContract));
    }

    // ============ Get Gate Config Hash Tests ============

    function testGetGateConfigHash() public {
        bytes32 expectedHash = keccak256(abi.encodePacked(TEST_PASSWORD));

        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: expectedHash
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        assertEq(gating.getGateConfigHash(SEASON_ID, 0), expectedHash);
    }

    function testGetGateConfigHashRevertsOnInvalidIndex() public {
        vm.expectRevert(ISeasonGating.InvalidGateIndex.selector);
        gating.getGateConfigHash(SEASON_ID, 0);
    }

    // ============ Multi-User Tests ============

    function testDifferentUsersCanVerifySameGate() public {
        // Setup gate
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked(TEST_PASSWORD))
        });

        vm.prank(admin);
        gating.configureGates(SEASON_ID, gates);

        // User 1 verifies
        vm.prank(user1);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);
        assertTrue(gating.isUserVerified(SEASON_ID, user1));

        // User 2 can also verify with same password
        vm.prank(user2);
        gating.verifyPassword(SEASON_ID, 0, TEST_PASSWORD);
        assertTrue(gating.isUserVerified(SEASON_ID, user2));
    }

    // ============ Multi-Season Tests ============

    function testDifferentSeasonsHaveIndependentGates() public {
        uint256 season1 = 1;
        uint256 season2 = 2;

        // Setup different passwords for different seasons
        ISeasonGating.GateConfig[] memory gates1 = new ISeasonGating.GateConfig[](1);
        gates1[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("season1password"))
        });

        ISeasonGating.GateConfig[] memory gates2 = new ISeasonGating.GateConfig[](1);
        gates2[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("season2password"))
        });

        vm.startPrank(admin);
        gating.configureGates(season1, gates1);
        gating.configureGates(season2, gates2);
        vm.stopPrank();

        // Verify for season 1
        vm.prank(user1);
        gating.verifyPassword(season1, 0, "season1password");

        assertTrue(gating.isUserVerified(season1, user1));
        assertFalse(gating.isUserVerified(season2, user1)); // Not verified for season 2
    }
}
