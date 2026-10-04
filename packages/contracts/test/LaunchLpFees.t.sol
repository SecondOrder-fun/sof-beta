// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {TokenLaunchpad} from "../src/launchpad/TokenLaunchpad.sol";
import {
    UniV4LiquidityPlacer,
    NoPlacement,
    FeeTreasuryNotSet,
    NotFeeRecipient,
    NothingToClaim,
    EthTransferFailed,
    NotPoolManager,
    ZeroAmount
} from "../src/launchpad/UniV4LiquidityPlacer.sol";
import {UniV4LaunchRouter} from "../src/launchpad/UniV4LaunchRouter.sol";
import {LaunchPoolGateDeployer} from "./helpers/LaunchPoolGateDeployer.sol";

/// @notice LP fee collection on launch positions, against a real PoolManager.
///
///         The placer owns every launch position, so the pools' 1% swap fee accrues to it
///         in both ETH (buys) and the launch token (sells). `collectFees` is permissionless
///         and splits 88/12 between the launch's fee recipient (its creator, until handed
///         on) and the platform treasury, on both sides.
contract LaunchLpFeesTest is Test, LaunchPoolGateDeployer {
    PoolManager internal manager;
    TokenLaunchpad internal launchpad;
    UniV4LiquidityPlacer internal placer;
    UniV4LaunchRouter internal router;

    address internal creator = address(0xC0FFEE);
    address internal treasury = address(0x7EA5);
    address internal trader = address(0xB0B);
    address internal stranger = address(0x5757);

    uint256 internal constant PRICE = 1_000_000_000; // 1 ETH FDV
    address internal token;

    function setUp() public {
        manager = new PoolManager(address(this));
        launchpad = new TokenLaunchpad(address(this), address(0), 1e9, 1e27);
        placer = new UniV4LiquidityPlacer(address(manager), address(launchpad), address(this), 10_000, 200, 46_000);
        launchpad.setPlacer(address(placer));
        placer.setGate(_deployGate(address(placer)));
        placer.setFeeTreasury(treasury);
        router = new UniV4LaunchRouter(address(manager), address(launchpad));
        launchpad.setRouter(address(router));

        vm.prank(creator);
        (, token) = launchpad.launch("Frog Pond", "POND", "", address(0), PRICE * 1e9);
        vm.deal(trader, 100 ether);
    }

    function _buy(uint256 ethIn) internal returns (uint256 out) {
        vm.prank(trader);
        out = router.buy{value: ethIn}(token, ethIn, 0, trader, block.timestamp);
    }

    function _sell(uint256 tokensIn) internal returns (uint256 out) {
        vm.startPrank(trader);
        IERC20(token).approve(address(router), tokensIn);
        out = router.sell(token, tokensIn, 0, trader, block.timestamp);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Collecting
    // ------------------------------------------------------------------

    function test_collectsBothSidesAndSplits88To12() public {
        uint256 bought = _buy(1 ether); // fee paid in ETH
        _sell(bought / 2); // fee paid in the token

        vm.prank(stranger); // permissionless
        (uint256 ethFees, uint256 tokenFees) = placer.collectFees(token);

        // 1% of the ETH in, less v4's rounding in the pool's favour on the fee growth.
        assertGt(ethFees, 0.0099 ether);
        assertLe(ethFees, 0.01 ether);
        assertGt(tokenFees, (bought / 2) / 101);
        assertLe(tokenFees, (bought / 2) / 100);

        uint256 creatorEth = (ethFees * 8_800) / 10_000;
        uint256 creatorTokens = (tokenFees * 8_800) / 10_000;
        assertEq(placer.claimable(address(0), creator), creatorEth);
        assertEq(placer.claimable(address(0), treasury), ethFees - creatorEth);
        assertEq(placer.claimable(token, creator), creatorTokens);
        assertEq(placer.claimable(token, treasury), tokenFees - creatorTokens);
        assertEq(placer.claimable(address(0), stranger), 0, "the caller earns nothing for collecting");

        assertEq(address(placer).balance, ethFees, "the placer holds exactly what it owes");
    }

    function test_collectingAgainWithoutTradesCreditsNothing() public {
        _buy(1 ether);
        placer.collectFees(token);
        uint256 creatorEth = placer.claimable(address(0), creator);

        (uint256 ethFees, uint256 tokenFees) = placer.collectFees(token);
        assertEq(ethFees, 0);
        assertEq(tokenFees, 0);
        assertEq(placer.claimable(address(0), creator), creatorEth);
    }

    function test_collectingLeavesThePositionTradeable() public {
        _buy(1 ether);
        placer.collectFees(token);
        uint256 more = _buy(0.1 ether);
        assertGt(more, 0);
        assertGt(_sell(more), 0);
    }

    function test_collectRequiresAPlacementAndATreasury() public {
        vm.expectRevert(abi.encodeWithSelector(NoPlacement.selector, address(0xF00)));
        placer.collectFees(address(0xF00));

        UniV4LiquidityPlacer bare =
            new UniV4LiquidityPlacer(address(manager), address(launchpad), address(this), 10_000, 200, 46_000);
        bare.setGate(_deployGate(address(bare)));
        launchpad.setPlacer(address(bare));
        vm.prank(creator);
        (, address other) = launchpad.launch("Other", "OTH", "", address(0), PRICE * 1e9);
        vm.expectRevert(FeeTreasuryNotSet.selector);
        bare.collectFees(other);
    }

    // ------------------------------------------------------------------
    // Claiming
    // ------------------------------------------------------------------

    function test_claimsPayOutAndEmptyThePlacer() public {
        uint256 bought = _buy(1 ether);
        _sell(bought / 2);
        placer.collectFees(token);

        uint256 creatorEth = placer.claimable(address(0), creator);
        uint256 creatorTokens = placer.claimable(token, creator);
        address wallet = address(0xA11);

        vm.startPrank(creator);
        assertEq(placer.claim(address(0), wallet), creatorEth);
        assertEq(placer.claim(token, wallet), creatorTokens);
        vm.stopPrank();
        assertEq(wallet.balance, creatorEth);
        assertEq(IERC20(token).balanceOf(wallet), creatorTokens);

        vm.startPrank(treasury);
        placer.claim(address(0), treasury);
        placer.claim(token, treasury);
        vm.stopPrank();

        assertEq(address(placer).balance, 0);
        assertEq(placer.totalClaimable(token), 0);

        vm.prank(creator);
        vm.expectRevert(NothingToClaim.selector);
        placer.claim(address(0), wallet);
    }

    /// A claim to an address that rejects ETH fails without losing the credit, so the
    /// claimant can retry to another address.
    function test_aFailedEthClaimKeepsTheCredit() public {
        _buy(1 ether);
        placer.collectFees(token);
        uint256 owed = placer.claimable(address(0), creator);

        address rejecting = address(new RejectsEth());
        vm.prank(creator);
        vm.expectRevert(EthTransferFailed.selector);
        placer.claim(address(0), rejecting);
        assertEq(placer.claimable(address(0), creator), owed);

        vm.prank(creator);
        placer.claim(address(0), creator);
        assertEq(creator.balance, owed);
    }

    // ------------------------------------------------------------------
    // The fee recipient
    // ------------------------------------------------------------------

    function test_recipientStartsAsTheCreatorAndOnlyTheyCanHandItOn() public {
        assertEq(placer.feeRecipientOf(token), creator);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotFeeRecipient.selector, stranger));
        placer.setFeeRecipient(token, stranger);

        address next = address(0x2E27);
        vm.prank(creator);
        placer.setFeeRecipient(token, next);
        assertEq(placer.feeRecipientOf(token), next);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(NotFeeRecipient.selector, creator));
        placer.setFeeRecipient(token, creator);
    }

    /// Shares are fixed when collected: fees credited before a handover stay credited.
    function test_handoverAppliesToLaterCollectionsOnly() public {
        _buy(1 ether);
        placer.collectFees(token);
        uint256 creatorBefore = placer.claimable(address(0), creator);

        address next = address(0x2E27);
        vm.prank(creator);
        placer.setFeeRecipient(token, next);

        _buy(1 ether);
        placer.collectFees(token);
        assertEq(placer.claimable(address(0), creator), creatorBefore, "earlier credit unchanged");
        assertGt(placer.claimable(address(0), next), 0, "later fees go to the new recipient");
    }

    // ------------------------------------------------------------------
    // Dust and stray ETH
    // ------------------------------------------------------------------

    function test_sweepDustNeverTakesUnclaimedFees() public {
        uint256 bought = _buy(1 ether);
        _sell(bought / 2);
        placer.collectFees(token);

        uint256 held = IERC20(token).balanceOf(address(placer));
        uint256 owed = placer.totalClaimable(token);
        assertGt(owed, 0);

        if (held > owed) {
            placer.sweepDust(token, address(this));
        } else {
            vm.expectRevert(ZeroAmount.selector);
            placer.sweepDust(token, address(this));
        }
        assertEq(IERC20(token).balanceOf(address(placer)), owed, "every unclaimed fee is still here");
    }

    function test_rejectsEthFromAnyoneButThePoolManager() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(placer).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(bytes4(ret), NotPoolManager.selector);
    }
}

contract RejectsEth {
    receive() external payable {
        revert("no");
    }
}
