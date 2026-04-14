// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {SimpleFPMM} from "../src/infofi/InfoFiFPMMV2.sol";
import {ConditionalTokenSOF} from "../src/infofi/ConditionalTokenSOF.sol";

contract FPMMPermitTest is Test {
    SOFToken public sofToken;
    ConditionalTokenSOF public ct;
    SimpleFPMM public fpmm;

    address public admin = address(0xAD);
    address public trader;
    uint256 public traderPk;
    address public treasury = address(0x7EEA);

    bytes32 public conditionId;

    function setUp() public {
        (trader, traderPk) = makeAddrAndKey("trader");

        vm.startPrank(admin);

        sofToken = new SOFToken("SOF", "SOF", 1_000_000e18);
        ct = new ConditionalTokenSOF();

        // Prepare a condition
        ct.prepareCondition(admin, bytes32(uint256(1)), 2);
        conditionId = ct.getConditionId(admin, bytes32(uint256(1)), 2);

        fpmm = new SimpleFPMM(
            address(sofToken), address(ct), conditionId,
            treasury, "FPMM-Test", "FPMM"
        );

        // Fund FPMM: split collateral into outcome tokens and seed reserves
        sofToken.approve(address(ct), 1000e18);
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ct.splitPosition(address(sofToken), bytes32(0), conditionId, partition, 1000e18);

        // Transfer outcome tokens to FPMM
        uint256 yesId = fpmm.positionIds(0);
        uint256 noId = fpmm.positionIds(1);
        ct.safeTransferFrom(admin, address(fpmm), yesId, 500e18, "");
        ct.safeTransferFrom(admin, address(fpmm), noId, 500e18, "");
        fpmm.initializeReserves(500e18, 500e18);

        // Give trader some SOF
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        sofToken.transfer(trader, 10_000e18);

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

    function test_buyWithPermit_atomicFlow() public {
        uint256 amountIn = 100e18;
        uint256 deadline = block.timestamp + 1 hours;

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(trader, traderPk, address(fpmm), amountIn, deadline);

        assertEq(sofToken.allowance(trader, address(fpmm)), 0);

        vm.prank(trader);
        uint256 amountOut = fpmm.buyWithPermit(true, amountIn, 0, deadline, v, r, s);

        assertGt(amountOut, 0);
    }

    function test_addLiquidityWithPermit_atomicFlow() public {
        uint256 amount = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(trader, traderPk, address(fpmm), amount, deadline);

        vm.prank(trader);
        uint256 lpTokens = fpmm.addLiquidityWithPermit(amount, deadline, v, r, s);

        assertGt(lpTokens, 0);
    }

    function test_buy_traditionalApproveStillWorks() public {
        vm.startPrank(trader);
        sofToken.approve(address(fpmm), type(uint256).max);
        uint256 out = fpmm.buy(true, 100e18, 0);
        vm.stopPrank();
        assertGt(out, 0);
    }
}
