// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/token/SOFToken.sol";
import "../src/token/RaffleToken.sol";
import "../src/curve/SOFBondingCurve.sol";
import "../src/lib/RaffleTypes.sol";

contract BondingCurvePermitTest is Test {
    SOFToken public sofToken;
    RaffleToken public raffleToken;
    SOFBondingCurve public curve;

    address public admin = address(0xAD);
    address public buyer;
    uint256 public buyerPk;
    address public treasury = address(0x7eA);

    uint256 constant INITIAL_SOF = 10_000e18;

    function setUp() public {
        (buyer, buyerPk) = makeAddrAndKey("buyer");

        vm.startPrank(admin);

        sofToken = new SOFToken("SOF", "SOF", INITIAL_SOF);
        sofToken.transfer(buyer, 5_000e18);

        curve = new SOFBondingCurve(address(sofToken), admin);

        raffleToken = new RaffleToken(
            "Season 1 Ticket", "SOF-1",
            1, "Season 1",
            block.timestamp, block.timestamp + 7 days
        );

        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(curve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(curve));

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({ rangeTo: 1000, price: 1e18 });

        curve.initializeCurve(address(raffleToken), steps, 100, 100, treasury);
        vm.stopPrank();
    }

    function _signPermit(
        address owner_, uint256 pk, address spender_, uint256 value_, uint256 deadline_
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner_, spender_, value_, sofToken.nonces(owner_), deadline_
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", sofToken.DOMAIN_SEPARATOR(), structHash)
        );
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_buyTokensWithPermit_atomicFlow() public {
        uint256 tokenAmount = 5;
        uint256 maxSof = 10e18;
        uint256 deadline = block.timestamp + 1 hours;

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(buyer, buyerPk, address(curve), maxSof, deadline);

        assertEq(sofToken.allowance(buyer, address(curve)), 0);

        vm.prank(buyer);
        curve.buyTokensWithPermit(tokenAmount, maxSof, deadline, v, r, s);

        assertEq(raffleToken.balanceOf(buyer), tokenAmount);
    }

    function test_buyTokensWithPermit_permitFrontrunResilience() public {
        uint256 tokenAmount = 5;
        uint256 maxSof = 10e18;
        uint256 deadline = block.timestamp + 1 hours;

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(buyer, buyerPk, address(curve), maxSof, deadline);

        // Attacker front-runs the permit
        sofToken.permit(buyer, address(curve), maxSof, deadline, v, r, s);

        // Buyer's tx should still succeed
        vm.prank(buyer);
        curve.buyTokensWithPermit(tokenAmount, maxSof, deadline, v, r, s);

        assertEq(raffleToken.balanceOf(buyer), tokenAmount);
    }

    function test_fullLifecycle_permitBuyThenSell() public {
        // Buy with permit
        uint256 tokenAmount = 10;
        uint256 maxSof = 20e18;
        uint256 deadline = block.timestamp + 1 hours;

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(buyer, buyerPk, address(curve), maxSof, deadline);

        vm.prank(buyer);
        curve.buyTokensWithPermit(tokenAmount, maxSof, deadline, v, r, s);
        assertEq(raffleToken.balanceOf(buyer), tokenAmount);

        // Sell (no permit needed — uses burnFrom with BURNER_ROLE)
        vm.prank(buyer);
        curve.sellTokens(5, 0);
        assertEq(raffleToken.balanceOf(buyer), 5);
    }

    function test_buyTokens_stillWorksWithTraditionalApprove() public {
        vm.startPrank(buyer);
        sofToken.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10e18);
        vm.stopPrank();

        assertEq(raffleToken.balanceOf(buyer), 5);
    }
}
