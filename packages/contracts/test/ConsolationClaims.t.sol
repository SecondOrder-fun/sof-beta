// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/RafflePrizeDistributor.sol";
import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// Mock ERC-20 token for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ConsolationClaimsTest is Test {
    RafflePrizeDistributor public distributor;
    MockERC20 public sofToken;

    address public raffle = address(0x1);
    address public grandWinner = address(0x2);
    address public loser1 = address(0x3);
    address public loser2 = address(0x4);
    address public loser3 = address(0x5);

    uint256 constant SEASON_ID = 1;
    uint256 constant GRAND_AMOUNT = 6500 ether;
    uint256 constant CONSOLATION_AMOUNT = 3500 ether;
    uint256 constant TOTAL_PARTICIPANTS = 4; // 1 winner + 3 losers

    function setUp() public {
        sofToken = new MockERC20("SOF", "SOF");
        distributor = new RafflePrizeDistributor(address(this));

        // Grant RAFFLE_ROLE to raffle address
        distributor.grantRole(distributor.RAFFLE_ROLE(), raffle);

        // Configure season
        vm.prank(raffle);
        distributor.configureSeason(
            SEASON_ID, address(sofToken), grandWinner, GRAND_AMOUNT, CONSOLATION_AMOUNT, TOTAL_PARTICIPANTS
        );

        // Fund the distributor
        sofToken.mint(address(distributor), GRAND_AMOUNT + CONSOLATION_AMOUNT);
        vm.prank(raffle);
        distributor.fundSeason(SEASON_ID, GRAND_AMOUNT + CONSOLATION_AMOUNT);
    }

    function testConsolationEqualDistribution() public {
        // Expected consolation per loser: 3500 / 3 = 1166.666... ether
        uint256 expectedPerLoser = CONSOLATION_AMOUNT / (TOTAL_PARTICIPANTS - 1);

        // Loser 1 claims
        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID);
        assertEq(sofToken.balanceOf(loser1), expectedPerLoser);

        // Loser 2 claims
        vm.prank(loser2);
        distributor.claimConsolation(SEASON_ID);
        assertEq(sofToken.balanceOf(loser2), expectedPerLoser);

        // Loser 3 claims
        vm.prank(loser3);
        distributor.claimConsolation(SEASON_ID);
        assertEq(sofToken.balanceOf(loser3), expectedPerLoser);

        // All losers received equal amounts
        assertEq(sofToken.balanceOf(loser1), sofToken.balanceOf(loser2));
        assertEq(sofToken.balanceOf(loser2), sofToken.balanceOf(loser3));
    }

    function testGrandWinnerCannotClaimConsolation() public {
        vm.prank(grandWinner);
        vm.expectRevert("Distributor: winner cannot claim consolation");
        distributor.claimConsolation(SEASON_ID);
    }

    function testCannotClaimConsolationTwice() public {
        vm.startPrank(loser1);
        distributor.claimConsolation(SEASON_ID);

        vm.expectRevert("Distributor: already claimed");
        distributor.claimConsolation(SEASON_ID);
        vm.stopPrank();
    }

    function testConsolationClaimStatus() public {
        // Initially not claimed
        assertFalse(distributor.isConsolationClaimed(SEASON_ID, loser1));

        // Claim
        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID);

        // Now claimed
        assertTrue(distributor.isConsolationClaimed(SEASON_ID, loser1));

        // Other losers still not claimed
        assertFalse(distributor.isConsolationClaimed(SEASON_ID, loser2));
        assertFalse(distributor.isConsolationClaimed(SEASON_ID, loser3));
    }

    function testConsolationRequiresFunded() public {
        // Create unfunded season
        vm.prank(raffle);
        distributor.configureSeason(
            2, address(sofToken), grandWinner, GRAND_AMOUNT, CONSOLATION_AMOUNT, TOTAL_PARTICIPANTS
        );

        // Try to claim before funding
        vm.prank(loser1);
        vm.expectRevert("Distributor: not funded");
        distributor.claimConsolation(2);
    }

    function testConsolationWithDifferentParticipantCounts() public {
        // Test with 10 participants (1 winner + 9 losers)
        uint256 season2 = 2;
        uint256 participants = 10;

        vm.prank(raffle);
        distributor.configureSeason(
            season2, address(sofToken), grandWinner, GRAND_AMOUNT, CONSOLATION_AMOUNT, participants
        );

        sofToken.mint(address(distributor), GRAND_AMOUNT + CONSOLATION_AMOUNT);
        vm.prank(raffle);
        distributor.fundSeason(season2, GRAND_AMOUNT + CONSOLATION_AMOUNT);

        // Expected: 3500 / 9 = 388.888... ether per loser
        uint256 expectedPerLoser = CONSOLATION_AMOUNT / (participants - 1);

        vm.prank(loser1);
        distributor.claimConsolation(season2);
        assertEq(sofToken.balanceOf(loser1), expectedPerLoser);
    }

    function testGetSeasonReturnsCorrectData() public view {
        IRafflePrizeDistributor.SeasonPayouts memory season = distributor.getSeason(SEASON_ID);

        assertEq(season.token, address(sofToken));
        assertEq(season.grandWinner, grandWinner);
        assertEq(season.grandAmount, GRAND_AMOUNT);
        assertEq(season.consolationAmount, CONSOLATION_AMOUNT);
        assertEq(season.totalParticipants, TOTAL_PARTICIPANTS);
        assertTrue(season.funded);
        assertFalse(season.grandClaimed);
    }

    function testGrandWinnerAndConsolationIndependent() public {
        // Grand winner claims their prize
        vm.prank(grandWinner);
        distributor.claimGrand(SEASON_ID);
        assertEq(sofToken.balanceOf(grandWinner), GRAND_AMOUNT);

        // Losers can still claim consolation
        uint256 expectedPerLoser = CONSOLATION_AMOUNT / (TOTAL_PARTICIPANTS - 1);

        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID);
        assertEq(sofToken.balanceOf(loser1), expectedPerLoser);

        vm.prank(loser2);
        distributor.claimConsolation(SEASON_ID);
        assertEq(sofToken.balanceOf(loser2), expectedPerLoser);
    }
}
