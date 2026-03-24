// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/gating/SeasonGating.sol";
import "../src/gating/ISeasonGating.sol";

contract SeasonGatingSignatureTest is Test {
    SeasonGating public gating;

    address public admin = address(0x1);
    address public raffleContract = address(0x2);
    address public signer;
    uint256 public signerPk;
    address public user;
    uint256 public userPk;

    uint256 public constant SEASON_ID = 1;

    bytes32 private constant SEASON_ALLOWLIST_TYPEHASH = keccak256(
        "SeasonAllowlist(uint256 seasonId,uint256 gateIndex,address participant,uint256 deadline)"
    );

    event UserVerified(
        uint256 indexed seasonId,
        uint256 indexed gateIndex,
        address indexed user,
        ISeasonGating.GateType gateType
    );

    function setUp() public {
        (signer, signerPk) = makeAddrAndKey("signer");
        (user, userPk) = makeAddrAndKey("user");

        vm.startPrank(admin);
        gating = new SeasonGating(admin, raffleContract);

        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.SIGNATURE,
            enabled: true,
            configHash: bytes32(uint256(uint160(signer)))
        });
        gating.configureGates(SEASON_ID, gates);
        vm.stopPrank();
    }

    function _signAllowlist(
        uint256 pk, uint256 seasonId, uint256 gateIndex, address participant, uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(
            SEASON_ALLOWLIST_TYPEHASH, seasonId, gateIndex, participant, deadline
        ));

        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("SecondOrder.fun SeasonGating"),
            keccak256("1"),
            block.chainid,
            address(gating)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_verifySignature_happyPath() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(signerPk, SEASON_ID, 0, user, deadline);

        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit UserVerified(SEASON_ID, 0, user, ISeasonGating.GateType.SIGNATURE);
        gating.verifySignature(SEASON_ID, 0, deadline, v, r, s);

        assertTrue(gating.isGateVerified(SEASON_ID, 0, user));
    }

    function test_verifySignature_reverts_expiredDeadline() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(signerPk, SEASON_ID, 0, user, deadline);

        vm.prank(user);
        vm.expectRevert(ISeasonGating.SignatureExpired.selector);
        gating.verifySignature(SEASON_ID, 0, deadline, v, r, s);
    }

    function test_verifySignature_reverts_wrongSigner() public {
        (, uint256 wrongPk) = makeAddrAndKey("wrong");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(wrongPk, SEASON_ID, 0, user, deadline);

        vm.prank(user);
        vm.expectRevert(ISeasonGating.InvalidSignature.selector);
        gating.verifySignature(SEASON_ID, 0, deadline, v, r, s);
    }

    function test_verifySignature_reverts_wrongParticipant() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(signerPk, SEASON_ID, 0, user, deadline);

        vm.prank(admin); // Not the intended participant
        vm.expectRevert(ISeasonGating.InvalidSignature.selector);
        gating.verifySignature(SEASON_ID, 0, deadline, v, r, s);
    }

    function test_verifySignature_reverts_alreadyVerified() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(signerPk, SEASON_ID, 0, user, deadline);

        vm.startPrank(user);
        gating.verifySignature(SEASON_ID, 0, deadline, v, r, s);

        vm.expectRevert(ISeasonGating.AlreadyVerified.selector);
        gating.verifySignature(SEASON_ID, 0, deadline, v, r, s);
        vm.stopPrank();
    }

    function test_verifySignature_reverts_gateTypeMismatch() public {
        vm.startPrank(admin);
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("password"))
        });
        gating.configureGates(2, gates);
        vm.stopPrank();

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(signerPk, 2, 0, user, deadline);

        vm.prank(user);
        vm.expectRevert(ISeasonGating.GateTypeMismatch.selector);
        gating.verifySignature(2, 0, deadline, v, r, s);
    }

    function test_passwordGate_stillWorks() public {
        vm.startPrank(admin);
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](1);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("secret"))
        });
        gating.configureGates(3, gates);
        vm.stopPrank();

        vm.prank(user);
        gating.verifyPassword(3, 0, "secret");

        assertTrue(gating.isGateVerified(3, 0, user));
    }

    function test_coexistence_passwordAndSignatureGates() public {
        vm.startPrank(admin);
        ISeasonGating.GateConfig[] memory gates = new ISeasonGating.GateConfig[](2);
        gates[0] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.PASSWORD,
            enabled: true,
            configHash: keccak256(abi.encodePacked("pass"))
        });
        gates[1] = ISeasonGating.GateConfig({
            gateType: ISeasonGating.GateType.SIGNATURE,
            enabled: true,
            configHash: bytes32(uint256(uint160(signer)))
        });
        gating.configureGates(4, gates);
        vm.stopPrank();

        assertFalse(gating.isUserVerified(4, user));

        vm.prank(user);
        gating.verifyPassword(4, 0, "pass");

        assertFalse(gating.isUserVerified(4, user));

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAllowlist(signerPk, 4, 1, user, deadline);

        vm.prank(user);
        gating.verifySignature(4, 1, deadline, v, r, s);

        assertTrue(gating.isUserVerified(4, user));
    }
}
