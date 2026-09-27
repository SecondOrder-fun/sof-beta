// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {
    TokenLaunchpad,
    EmptyName,
    EmptySymbol,
    NameTooLong,
    SymbolTooLong,
    StartPriceOutOfRange,
    PlacerNotSet,
    LaunchpadHoldsResidualTokens,
    InvalidPriceBounds
} from "../src/launchpad/TokenLaunchpad.sol";
import {LaunchToken} from "../src/launchpad/LaunchToken.sol";
import {ILiquidityPlacer} from "../src/launchpad/ILiquidityPlacer.sol";

/// @dev Consumes everything it is given, as the interface requires.
contract MockPlacer is ILiquidityPlacer {
    address public lastToken;
    uint256 public lastAmount;
    uint256 public lastStartPriceWei;
    uint256 public calls;

    function place(address token, uint256 amount, uint256 startPriceWei) external returns (bytes32) {
        lastToken = token;
        lastAmount = amount;
        lastStartPriceWei = startPriceWei;
        calls++;
        return keccak256(abi.encode(token, amount));
    }
}

/// @dev Leaves tokens behind. The launchpad must reject this rather than strand supply.
contract LeakyPlacer is ILiquidityPlacer {
    function place(address token, uint256 amount, uint256) external returns (bytes32) {
        // Return half to the launchpad, simulating a partial placement.
        IERC20(token).transfer(msg.sender, amount / 2);
        return bytes32(0);
    }
}

contract TokenLaunchpadTest is Test {
    TokenLaunchpad internal launchpad;
    MockPlacer internal placer;

    address internal admin = address(this);
    address internal creator = address(0xC0FFEE);
    address internal stranger = address(0xBAD);

    uint256 internal constant MIN_PRICE = 1; // 1 wei per whole token
    uint256 internal constant MAX_PRICE = 1 ether;
    uint256 internal constant PRICE = 1_000_000; // 1e6 wei per whole token

    function setUp() public {
        placer = new MockPlacer();
        launchpad = new TokenLaunchpad(admin, address(placer), MIN_PRICE, MAX_PRICE);
    }

    function _launch(string memory name, string memory symbol) internal returns (uint256 id, address token) {
        vm.prank(creator);
        return launchpad.launch(name, symbol, "ipfs://meta", PRICE);
    }

    // ------------------------------------------------------------------
    // The happy path, and the properties that define it
    // ------------------------------------------------------------------

    function test_launchIsPermissionlessAndFree() public {
        uint256 balanceBefore = stranger.balance;

        vm.prank(stranger);
        (uint256 id, address token) = launchpad.launch("Anyone", "ANY", "", PRICE);

        assertEq(id, 0);
        assertTrue(token != address(0));
        assertEq(stranger.balance, balanceBefore, "launching must cost nothing but gas");
    }

    /// The token must be 18 decimals, because Raffle asserts exactly that before a token
    /// may denominate a season. A launchpad that minted anything else would produce
    /// tokens that can never host a raffle.
    function test_launchedTokenIsEighteenDecimalsWithPermit() public {
        (, address token) = _launch("Eighteen", "E18");

        assertEq(IERC20Metadata(token).decimals(), 18);
        // ERC-2612: a non-reverting DOMAIN_SEPARATOR is the observable marker.
        assertTrue(LaunchToken(token).DOMAIN_SEPARATOR() != bytes32(0));
        assertEq(LaunchToken(token).nonces(creator), 0);
    }

    /// No free dev allocation: the creator ends the launch holding nothing.
    function test_creatorReceivesNoTokens() public {
        (, address token) = _launch("NoAlloc", "NOAL");

        assertEq(IERC20(token).balanceOf(creator), 0, "creator must receive no allocation");
        assertEq(LaunchToken(token).creator(), creator, "but is still recorded for attribution");
    }

    /// The entire supply is placed. Nothing is reserved for the protocol either, so a
    /// launched token carries no overhang at all.
    function test_entireSupplyGoesToThePlacer() public {
        (, address token) = _launch("AllOut", "ALL");

        assertEq(IERC20(token).balanceOf(address(placer)), launchpad.TOKEN_SUPPLY());
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "launchpad must hold nothing");
        assertEq(IERC20(token).totalSupply(), launchpad.TOKEN_SUPPLY());
        assertEq(placer.lastAmount(), launchpad.TOKEN_SUPPLY());
        assertEq(placer.lastStartPriceWei(), PRICE, "creator's starting price reaches the placer");
    }

    function test_launchIsRecordedAndQueryable() public {
        (uint256 id, address token) = _launch("Recorded", "REC");

        assertEq(launchpad.launchCount(), 1);
        assertTrue(launchpad.isLaunchToken(token));

        TokenLaunchpad.Launch memory l = launchpad.getLaunch(id);
        assertEq(l.token, token);
        assertEq(l.creator, creator);
        assertEq(l.startPriceWei, PRICE);

        (uint256 foundId, bool exists) = launchpad.launchIdOf(token);
        assertTrue(exists);
        assertEq(foundId, id);
    }

    /// `isLaunchToken` is what season creation will trust, so a non-launchpad address
    /// must never read as one.
    function test_unknownTokenIsNotALaunchToken() public view {
        assertFalse(launchpad.isLaunchToken(address(0xDEAD)));
        (, bool exists) = launchpad.launchIdOf(address(0xDEAD));
        assertFalse(exists);
    }

    function test_multipleLaunchesGetDistinctTokensAndIds() public {
        (uint256 id1, address t1) = _launch("One", "ONE");
        (uint256 id2, address t2) = _launch("Two", "TWO");

        assertEq(id1, 0);
        assertEq(id2, 1);
        assertTrue(t1 != t2);
        assertEq(launchpad.launchCount(), 2);
        assertEq(placer.calls(), 2);
    }

    // ------------------------------------------------------------------
    // Guards
    // ------------------------------------------------------------------

    function test_startPriceMustBeInBounds() public {
        vm.startPrank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(StartPriceOutOfRange.selector, MIN_PRICE - 1, MIN_PRICE, MAX_PRICE)
        );
        launchpad.launch("Low", "LOW", "", MIN_PRICE - 1);

        vm.expectRevert(
            abi.encodeWithSelector(StartPriceOutOfRange.selector, MAX_PRICE + 1, MIN_PRICE, MAX_PRICE)
        );
        launchpad.launch("High", "HIGH", "", MAX_PRICE + 1);
        vm.stopPrank();
    }

    function test_nameAndSymbolAreValidated() public {
        vm.startPrank(creator);
        vm.expectRevert(EmptyName.selector);
        launchpad.launch("", "SYM", "", PRICE);

        vm.expectRevert(EmptySymbol.selector);
        launchpad.launch("Name", "", "", PRICE);

        string memory longName = new string(49);
        vm.expectRevert(NameTooLong.selector);
        launchpad.launch(longName, "SYM", "", PRICE);

        string memory longSymbol = new string(17);
        vm.expectRevert(SymbolTooLong.selector);
        launchpad.launch("Name", longSymbol, "", PRICE);
        vm.stopPrank();
    }

    /// A placer that keeps only part of the supply would strand the rest in the
    /// launchpad forever — outside the market and outside anyone's reach. Fail instead.
    function test_launchRevertsIfPlacerLeavesResidualSupply() public {
        launchpad.setPlacer(address(new LeakyPlacer()));

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadHoldsResidualTokens.selector, launchpad.TOKEN_SUPPLY() / 2)
        );
        launchpad.launch("Leaky", "LEAK", "", PRICE);
    }

    function test_launchRevertsWhenNoPlacerConfigured() public {
        TokenLaunchpad bare = new TokenLaunchpad(admin, address(0), MIN_PRICE, MAX_PRICE);

        vm.prank(creator);
        vm.expectRevert(PlacerNotSet.selector);
        bare.launch("NoPlacer", "NOP", "", PRICE);
    }

    function test_constructorRejectsInvertedPriceBounds() public {
        vm.expectRevert(InvalidPriceBounds.selector);
        new TokenLaunchpad(admin, address(placer), 2, 1);

        vm.expectRevert(InvalidPriceBounds.selector);
        new TokenLaunchpad(admin, address(placer), 0, 1);
    }

    // ------------------------------------------------------------------
    // Config and pausing
    // ------------------------------------------------------------------

    function test_pauseStopsNewLaunchesOnly() public {
        (, address existing) = _launch("Before", "BEF");

        launchpad.pause();

        vm.prank(creator);
        vm.expectRevert();
        launchpad.launch("During", "DUR", "", PRICE);

        // The already-launched token is untouched: supply still placed, still tradeable
        // wherever the placer put it. Pausing is a control on this contract, not on pools.
        assertEq(IERC20(existing).balanceOf(address(placer)), launchpad.TOKEN_SUPPLY());

        launchpad.unpause();
        (uint256 id,) = _launch("After", "AFT");
        assertEq(id, 1);
    }

    function test_onlyConfigRoleCanChangePlacerOrBounds() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        launchpad.setPlacer(address(placer));
        vm.expectRevert();
        launchpad.setStartPriceBounds(1, 2);
        vm.stopPrank();
    }

    function test_onlyEmergencyRoleCanPause() public {
        vm.prank(stranger);
        vm.expectRevert();
        launchpad.pause();
    }

    function test_setStartPriceBoundsRejectsInverted() public {
        vm.expectRevert(InvalidPriceBounds.selector);
        launchpad.setStartPriceBounds(5, 4);
    }
}
