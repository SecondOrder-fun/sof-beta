// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle} from "../../src/core/Raffle.sol";
import {RaffleStorage} from "../../src/core/RaffleStorage.sol";
import {SeasonFactory} from "../../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../../src/core/RafflePrizeDistributor.sol";
import {SOFBondingCurve} from "../../src/curve/SOFBondingCurve.sol";
import {SOFToken} from "../../src/token/SOFToken.sol";
import {RaffleTypes} from "../../src/lib/RaffleTypes.sol";

// Harness that exposes internal VRF fulfillment for testing
contract RaffleTestHarness is Raffle {
    constructor(address sof, address coord, uint256 subId, bytes32 keyHash)
        Raffle(sof, coord, subId, keyHash)
    {}

    /// @notice Simulate requestSeasonEnd by locking trading and setting VRFPending
    function testRequestSeasonEnd(uint256 seasonId, uint256 requestId) external {
        SOFBondingCurve(seasons[seasonId].bondingCurve).lockTrading();
        seasonStates[seasonId].totalPrizePool =
            SOFBondingCurve(seasons[seasonId].bondingCurve).getSofReserves();
        seasons[seasonId].isActive = false;
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        seasonStates[seasonId].vrfRequestTimestamp = block.timestamp;
        vrfRequestToSeason[requestId] = seasonId;
    }

    /// @notice Fulfill VRF words and auto-finalize; fall back to manual finalize if needed
    function testFulfillAndFinalize(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
        uint256 seasonId = vrfRequestToSeason[requestId];
        if (seasonStates[seasonId].status == SeasonStatus.Distributing) {
            this.finalizeSeason(seasonId);
        }
    }
}

contract FullSeasonFlowTest is Test {
    // Core contracts
    RaffleTestHarness public raffle;
    SeasonFactory public seasonFactory;
    SOFToken public sof;
    RafflePrizeDistributor public distributor;

    // Test addresses
    address public admin;
    address public player1;
    address public player2;
    address public player3;
    address public treasury;

    // Season data
    uint256 public seasonId;
    SOFBondingCurve public curve;

    function setUp() public {
        admin = address(this);
        player1 = address(0xA1);
        player2 = address(0xA2);
        player3 = address(0xA3);
        treasury = address(0xFEE);

        // Deploy SOF token (name, symbol, initialSupply)
        sof = new SOFToken("SecondOrder Fun Token", "SOF", 1_000_000 * 10 ** 18);

        // Deploy Raffle harness with mock VRF coordinator
        address mockCoordinator = address(0xCAFE);
        raffle = new RaffleTestHarness(
            address(sof),
            mockCoordinator,
            1, // subscriptionId
            bytes32(0) // keyHash
        );

        // Deploy SeasonFactory (needs raffle address)
        seasonFactory = new SeasonFactory(address(raffle));

        // Wire SeasonFactory into Raffle (one-time setter)
        raffle.setSeasonFactory(address(seasonFactory));

        // Set up prize distributor
        distributor = new RafflePrizeDistributor(admin);
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle));
        raffle.setPrizeDistributor(address(distributor));

        // Transfer SOF to players
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        sof.transfer(player1, 10_000 ether);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        sof.transfer(player2, 10_000 ether);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        sof.transfer(player3, 10_000 ether);

        // Create a season
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](3);
        steps[0] = RaffleTypes.BondStep({rangeTo: uint128(1000), price: uint128(1 ether)});
        steps[1] = RaffleTypes.BondStep({rangeTo: uint128(5000), price: uint128(2 ether)});
        steps[2] = RaffleTypes.BondStep({rangeTo: uint128(10000), price: uint128(3 ether)});

        RaffleTypes.SeasonConfig memory config;
        config.name = "Integration Test Season";
        config.startTime = block.timestamp + 1;
        config.endTime = block.timestamp + 1 days;
        config.winnerCount = 3;
        config.grandPrizeBps = 6500; // 65%
        config.treasuryAddress = treasury;

        seasonId = raffle.createSeason(config, steps, 50, 70); // 0.5% buy fee, 0.7% sell fee

        // Retrieve the deployed bonding curve
        (RaffleTypes.SeasonConfig memory deployed,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(deployed.bondingCurve);
    }

    function testFullSeasonFlow() public {
        // Step 1: Start the season (warp past startTime)
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Step 2: Players buy tickets via bonding curve
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(500, 10_000 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(300, 10_000 ether);
        vm.stopPrank();

        vm.startPrank(player3);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(200, 10_000 ether);
        vm.stopPrank();

        // Step 3: Verify participants are tracked
        address[] memory participants = raffle.getParticipants(seasonId);
        assertEq(participants.length, 3, "Should have 3 participants");

        // Step 4: Verify ticket balances
        (,, uint256 totalParticipants, uint256 totalTickets,) =
            raffle.getSeasonDetails(seasonId);
        assertEq(totalParticipants, 3, "Should have 3 participants in state");
        assertEq(totalTickets, 1000, "Total tickets should be 1000");

        // Step 5: Warp past endTime and simulate season end + VRF
        vm.warp(block.timestamp + 1 days);
        uint256 vrfRequestId = 42;
        raffle.testRequestSeasonEnd(seasonId, vrfRequestId);

        // Step 6: Verify season is locked
        (,RaffleStorage.SeasonStatus statusAfterLock,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(
            uint8(statusAfterLock),
            uint8(RaffleStorage.SeasonStatus.VRFPending),
            "Season should be VRFPending"
        );

        // Step 7: Trading should be locked
        vm.startPrank(player1);
        vm.expectRevert(abi.encodeWithSignature("TradingLocked()"));
        curve.buyTokens(1, 10 ether);
        vm.stopPrank();

        // Step 8: Fulfill VRF with random words and finalize
        uint256[] memory randomWords = new uint256[](3);
        randomWords[0] = uint256(keccak256("winner1"));
        randomWords[1] = uint256(keccak256("winner2"));
        randomWords[2] = uint256(keccak256("winner3"));
        raffle.testFulfillAndFinalize(vrfRequestId, randomWords);

        // Step 9: Verify season completed
        (,RaffleStorage.SeasonStatus finalStatus,,, uint256 prizePool) =
            raffle.getSeasonDetails(seasonId);
        assertEq(
            uint8(finalStatus),
            uint8(RaffleStorage.SeasonStatus.Completed),
            "Season should be Completed"
        );
        assertTrue(prizePool > 0, "Prize pool should be non-zero");

        // Step 10: Verify winners
        address[] memory winners = raffle.getWinners(seasonId);
        assertEq(winners.length, 3, "Should have 3 winners");

        // Every winner must be a participant
        for (uint256 i = 0; i < winners.length; i++) {
            bool found;
            for (uint256 j = 0; j < participants.length; j++) {
                if (winners[i] == participants[j]) {
                    found = true;
                    break;
                }
            }
            assertTrue(found, "Winner must be a participant");
        }
    }

    function testPlayerCanSellBeforeSeasonEnd() public {
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Player buys tokens
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(100, 10_000 ether);

        uint256 balanceBefore = sof.balanceOf(player1);

        // Player sells tokens back
        curve.sellTokens(50, 0);
        uint256 balanceAfter = sof.balanceOf(player1);
        assertTrue(balanceAfter > balanceBefore, "Player should receive SOF back from selling");
        vm.stopPrank();
    }

    function testMultiplePlayersAndPrizePoolAccumulates() public {
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Multiple players buy
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(100, 10_000 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(200, 10_000 ether);
        vm.stopPrank();

        // Verify SOF reserves accumulated in curve
        uint256 reserves = curve.getSofReserves();
        assertTrue(reserves > 0, "Curve should hold SOF reserves");
    }
}
