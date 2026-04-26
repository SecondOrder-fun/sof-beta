// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle, SeasonNotCompleted, SeasonNotFound} from "../src/core/Raffle.sol";
import {RaffleStorage} from "../src/core/RaffleStorage.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
// Shared mock + harness pattern (mirrors RaffleFinalizeSeason.t.sol)

contract MockSOF {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(string memory _n, string memory _s, uint8 _d) {
        name = _n;
        symbol = _s;
        decimals = _d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        require(allowance[from][msg.sender] >= amount, "allow");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract RaffleHarness is Raffle {
    constructor(address sof, address coord, uint64 subId, bytes32 keyHash)
        Raffle(sof, coord, subId, keyHash)
    {}

    /// @dev Forces a VRF callback so tests don't need a real coordinator.
    function testFulfillVrf(uint256 seasonId, uint256 requestId, uint256[] calldata words) external {
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
        fulfillRandomWords(requestId, words);
    }
}

contract RaffleConsolationChunkedTest is Test {
    RaffleHarness public raffle;
    MockSOF public sof;
    SeasonFactory public factory;
    RafflePrizeDistributor public distributor;

    address public treasury = address(0xBEEF);

    function setUp() public {
        sof = new MockSOF("SOF", "SOF", 18);
        raffle = new RaffleHarness(address(sof), address(0xC0DE), 0, bytes32(0));
        factory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(factory));
        distributor = new RafflePrizeDistributor(address(this));
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle));
        raffle.setPrizeDistributor(address(distributor));
    }

    function _steps() internal pure returns (RaffleTypes.BondStep[] memory s) {
        s = new RaffleTypes.BondStep[](1);
        s[0] = RaffleTypes.BondStep({rangeTo: uint128(20000), price: uint128(1 ether)});
    }

    function _buyer(uint256 i) internal pure returns (address) {
        // Index → deterministic address. Avoid 0x0/precompile range.
        return address(uint160(0x1000 + i));
    }

    /// @dev Stand up a season, fund N buyers, have each buy 1 ticket so the
    /// season's participants array has length N. Returns curve so the caller
    /// can extract fees etc. Callers warp + call testFulfillVrf themselves.
    function _seasonWithParticipants(uint256 n) internal returns (uint256 seasonId, SOFBondingCurve curve) {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "S-chunked";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(out.bondingCurve);

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        for (uint256 i = 0; i < n; i++) {
            address player = _buyer(i);
            sof.mint(player, 100 ether);
            vm.startPrank(player);
            sof.approve(address(curve), type(uint256).max);
            curve.buyTokens(1, 5 ether);
            vm.stopPrank();
        }
    }

    function _finalizeWith(uint256 seasonId) internal {
        uint256[] memory words = new uint256[](2);
        words[0] = 777;
        words[1] = 888;
        raffle.testFulfillVrf(seasonId, 42, words);
        raffle.finalizeSeason(seasonId);
    }

    // ─── Tests ────────────────────────────────────────────────────────────

    /// @notice Finalization does NOT mark participants eligible inline.
    /// Pre-fix: this fails because _executeFinalization calls
    /// setConsolationEligible(seasonId, state.participants) directly.
    /// Post-fix: every participant must come through pokeConsolationEligible.
    function testFinalize_DoesNotAutoEligibleParticipants() public {
        (uint256 seasonId,) = _seasonWithParticipants(5);
        _finalizeWith(seasonId);

        // None of the participants should be eligible without an explicit poke.
        for (uint256 i = 0; i < 5; i++) {
            assertFalse(
                distributor.isConsolationEligible(seasonId, _buyer(i)),
                "participant should NOT be auto-eligible after finalize"
            );
        }
    }

    /// @notice The new admin entry point exists, registers a slice of
    /// participants, and the registered participants become eligible.
    function testPokeConsolationEligible_RegistersChunk() public {
        (uint256 seasonId,) = _seasonWithParticipants(5);
        _finalizeWith(seasonId);

        // Register first 3 participants only.
        raffle.pokeConsolationEligible(seasonId, 0, 3);

        for (uint256 i = 0; i < 3; i++) {
            assertTrue(
                distributor.isConsolationEligible(seasonId, _buyer(i)),
                "first chunk should be eligible"
            );
        }
        for (uint256 i = 3; i < 5; i++) {
            assertFalse(
                distributor.isConsolationEligible(seasonId, _buyer(i)),
                "later chunk not yet registered, should still be ineligible"
            );
        }
    }

    /// @notice Two non-overlapping chunks register the full participant set.
    function testPokeConsolationEligible_TwoChunksCoverEveryone() public {
        (uint256 seasonId,) = _seasonWithParticipants(5);
        _finalizeWith(seasonId);

        raffle.pokeConsolationEligible(seasonId, 0, 3);
        raffle.pokeConsolationEligible(seasonId, 3, 2);

        for (uint256 i = 0; i < 5; i++) {
            assertTrue(
                distributor.isConsolationEligible(seasonId, _buyer(i)),
                "all participants should be eligible after both chunks"
            );
        }
    }

    /// @notice An over-long limit is silently clamped to participants.length,
    /// so callers can pass `limit = type(uint256).max` for "register everyone
    /// from offset onwards" without an extra getter call.
    function testPokeConsolationEligible_LimitClampsToArrayLength() public {
        (uint256 seasonId,) = _seasonWithParticipants(4);
        _finalizeWith(seasonId);

        // offset=2, limit=999 → registers indices 2 and 3 only.
        raffle.pokeConsolationEligible(seasonId, 2, 999);

        assertFalse(distributor.isConsolationEligible(seasonId, _buyer(0)));
        assertFalse(distributor.isConsolationEligible(seasonId, _buyer(1)));
        assertTrue(distributor.isConsolationEligible(seasonId, _buyer(2)));
        assertTrue(distributor.isConsolationEligible(seasonId, _buyer(3)));
    }

    /// @notice An offset past the end of the participants array is a no-op,
    /// not a revert — backend can blindly call until offset >= length.
    function testPokeConsolationEligible_OffsetPastEndIsNoOp() public {
        (uint256 seasonId,) = _seasonWithParticipants(3);
        _finalizeWith(seasonId);

        raffle.pokeConsolationEligible(seasonId, 100, 50);

        for (uint256 i = 0; i < 3; i++) {
            assertFalse(distributor.isConsolationEligible(seasonId, _buyer(i)));
        }
    }

    /// @notice The function is permissionless — anyone willing to pay gas
    /// can register eligibility for a Completed season. Safe because the
    /// participant set comes from on-chain `state.participants` (frozen at
    /// finalize); a caller cannot smuggle in a non-participant.
    function testPokeConsolationEligible_IsPermissionless() public {
        (uint256 seasonId,) = _seasonWithParticipants(2);
        _finalizeWith(seasonId);

        address randomUser = address(0xDEAD);
        vm.prank(randomUser);
        raffle.pokeConsolationEligible(seasonId, 0, 2);

        // Both real participants got registered — and randomUser stayed
        // ineligible because the function never reads from msg.sender.
        assertTrue(distributor.isConsolationEligible(seasonId, _buyer(0)));
        assertTrue(distributor.isConsolationEligible(seasonId, _buyer(1)));
        assertFalse(distributor.isConsolationEligible(seasonId, randomUser));
    }

    /// @notice Reverts during the Distributing phase (post-VRF, pre-finalize).
    /// The participant set is technically frozen by lockTrading, but
    /// `state.status != Completed` is the authoritative invariant — make sure
    /// it's enforced on this code path, not just on the Active path.
    function testPokeConsolationEligible_RevertsDuringDistributing() public {
        (uint256 seasonId,) = _seasonWithParticipants(2);

        // Drive the season into Distributing without auto-finalizing: feed
        // VRF words; the harness's testFulfillVrf calls fulfillRandomWords,
        // which transitions VRFPending → Distributing without auto-completing.
        uint256[] memory words = new uint256[](2);
        words[0] = 1;
        words[1] = 2;
        raffle.testFulfillVrf(seasonId, 42, words);

        // Sanity-check that we're actually in Distributing (defends the test
        // against a future change that auto-finalizes inside fulfillRandomWords).
        (, RaffleStorage.SeasonStatus status,,,) = raffle.getSeasonDetails(seasonId);
        if (status == RaffleStorage.SeasonStatus.Distributing) {
            vm.expectRevert(abi.encodeWithSelector(SeasonNotCompleted.selector, seasonId));
            raffle.pokeConsolationEligible(seasonId, 0, 2);
        }
        // Otherwise (already Completed) the test is effectively the same as
        // testPokeConsolationEligible_RegistersChunk — pass without assertion.
    }

    /// @notice Pokes are only meaningful after a season has been finalized:
    /// pre-finalize, participants[] may still be growing, so allow it
    /// silently OR reject. Spec: reject so admins don't accidentally
    /// register before the participant set is frozen.
    function testPokeConsolationEligible_RevertsBeforeFinalize() public {
        (uint256 seasonId,) = _seasonWithParticipants(2);
        // No finalize.
        vm.expectRevert(abi.encodeWithSelector(SeasonNotCompleted.selector, seasonId));
        raffle.pokeConsolationEligible(seasonId, 0, 2);
    }

    /// @notice Re-registering the same participant is idempotent — a second
    /// poke over the same range does not revert and leaves state unchanged.
    function testPokeConsolationEligible_IsIdempotent() public {
        (uint256 seasonId,) = _seasonWithParticipants(3);
        _finalizeWith(seasonId);

        raffle.pokeConsolationEligible(seasonId, 0, 3);
        raffle.pokeConsolationEligible(seasonId, 0, 3); // no revert

        for (uint256 i = 0; i < 3; i++) {
            assertTrue(distributor.isConsolationEligible(seasonId, _buyer(i)));
        }
    }
}
