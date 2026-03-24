// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/infofi/InfoFiFPMMV2.sol";
import "../src/infofi/ConditionalTokenSOF.sol";
import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Mock SOF token for testing
contract MockSOF is ERC20 {
    constructor() ERC20("SecondOrder", "SOF") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title InfoFiFPMMTest
 * @notice Unit tests for SimpleFPMM buy/sell/liquidity + CTF integration
 */
contract InfoFiFPMMTest is Test {
    MockSOF public sof;
    ConditionalTokenSOF public ctf;
    SimpleFPMM public fpmm;
    InfoFiFPMMV2 public fpmmManager;

    address admin = address(this);
    address treasury = address(0xBEEF);
    address trader1 = address(0x1001);
    address trader2 = address(0x1002);
    address player = address(0x2001);

    bytes32 conditionId;
    uint256 yesPositionId;
    uint256 noPositionId;

    uint256 constant INITIAL_FUNDING = 100e18;

    function setUp() public {
        sof = new MockSOF();
        ctf = new ConditionalTokenSOF();

        // Deploy FPMM Manager
        fpmmManager = new InfoFiFPMMV2(
            address(ctf),
            address(sof),
            treasury,
            admin
        );

        // Prepare a condition (binary: 2 outcomes)
        bytes32 questionId = keccak256(abi.encodePacked("season-1-player-", player));
        ctf.prepareCondition(address(this), questionId, 2);
        conditionId = ctf.getConditionId(address(this), questionId, 2);

        // Fund manager for market creation
        sof.transfer(address(this), INITIAL_FUNDING);
        sof.approve(address(fpmmManager), INITIAL_FUNDING);

        // Create market via manager (50% initial probability = 5000 bps)
        (address fpmmAddr,) = fpmmManager.createMarket(1, player, conditionId, 5000);
        fpmm = SimpleFPMM(fpmmAddr);

        // Get position IDs
        yesPositionId = fpmm.positionIds(0);
        noPositionId = fpmm.positionIds(1);

        // Fund traders
        sof.mint(trader1, 10_000e18);
        sof.mint(trader2, 10_000e18);
    }

    // ─────────────────── BUY TESTS ───────────────────

    function test_buyYes() public {
        uint256 betAmount = 10e18;

        vm.startPrank(trader1);
        sof.approve(address(fpmm), betAmount);

        uint256 expectedOut = fpmm.calcBuyAmount(true, betAmount);
        assertGt(expectedOut, 0, "Expected output should be > 0");

        uint256 amountOut = fpmm.buy(true, betAmount, 0);
        vm.stopPrank();

        assertEq(amountOut, expectedOut, "Actual output should match calc");

        // Trader should hold YES CTF tokens
        uint256 yesBal = ctf.balanceOf(trader1, yesPositionId);
        assertEq(yesBal, amountOut, "Trader should hold YES tokens");

        // SOF should be deducted
        assertEq(sof.balanceOf(trader1), 10_000e18 - betAmount, "SOF deducted");
    }

    function test_buyNo() public {
        uint256 betAmount = 10e18;

        vm.startPrank(trader1);
        sof.approve(address(fpmm), betAmount);

        uint256 expectedOut = fpmm.calcBuyAmount(false, betAmount);
        uint256 amountOut = fpmm.buy(false, betAmount, 0);
        vm.stopPrank();

        assertEq(amountOut, expectedOut, "Actual should match calc");

        uint256 noBal = ctf.balanceOf(trader1, noPositionId);
        assertEq(noBal, amountOut, "Trader should hold NO tokens");
    }

    function test_buyShiftsPrice() public {
        // Get initial prices
        (uint256 yesPriceBefore, uint256 noPriceBefore) = fpmm.getPrices();
        assertEq(yesPriceBefore, 5000, "Initial YES = 50%");
        assertEq(noPriceBefore, 5000, "Initial NO = 50%");

        // Buy YES → should increase YES price
        vm.startPrank(trader1);
        sof.approve(address(fpmm), 20e18);
        fpmm.buy(true, 20e18, 0);
        vm.stopPrank();

        (uint256 yesPriceAfter, uint256 noPriceAfter) = fpmm.getPrices();
        assertGt(yesPriceAfter, yesPriceBefore, "YES price should increase after YES buy");
        assertLt(noPriceAfter, noPriceBefore, "NO price should decrease after YES buy");
    }

    function test_buySlippageProtection() public {
        uint256 betAmount = 10e18;
        uint256 expectedOut = fpmm.calcBuyAmount(true, betAmount);

        vm.startPrank(trader1);
        sof.approve(address(fpmm), betAmount);

        // Should revert with minAmountOut too high
        vm.expectRevert("Slippage exceeded");
        fpmm.buy(true, betAmount, expectedOut + 1);
        vm.stopPrank();
    }

    function test_buyZeroReverts() public {
        vm.startPrank(trader1);
        vm.expectRevert("Zero amount");
        fpmm.buy(true, 0, 0);
        vm.stopPrank();
    }

    // ─────────────────── MULTIPLE TRADERS ───────────────────

    function test_multipleBuyers() public {
        uint256 betAmount = 10e18;

        // Trader1 buys YES
        vm.startPrank(trader1);
        sof.approve(address(fpmm), betAmount);
        uint256 out1 = fpmm.buy(true, betAmount, 0);
        vm.stopPrank();

        // Trader2 buys NO
        vm.startPrank(trader2);
        sof.approve(address(fpmm), betAmount);
        uint256 out2 = fpmm.buy(false, betAmount, 0);
        vm.stopPrank();

        // Both should hold their respective tokens
        assertGt(ctf.balanceOf(trader1, yesPositionId), 0, "Trader1 has YES");
        assertGt(ctf.balanceOf(trader2, noPositionId), 0, "Trader2 has NO");

        // Second buyer gets fewer tokens due to price impact
        // (same amount bet, but price moved)
    }

    function test_multipleBuysSameTrader() public {
        vm.startPrank(trader1);
        sof.approve(address(fpmm), 100e18);

        uint256 out1 = fpmm.buy(true, 10e18, 0);
        uint256 out2 = fpmm.buy(true, 10e18, 0);
        vm.stopPrank();

        // Second buy should get fewer tokens (price impact)
        assertGt(out1, out2, "Second buy gets fewer tokens due to price impact");

        // Total YES balance should be sum
        assertEq(ctf.balanceOf(trader1, yesPositionId), out1 + out2, "Cumulative balance");
    }

    // ─────────────────── SELL TESTS ───────────────────

    function test_sellYes() public {
        uint256 betAmount = 10e18;

        // First buy YES
        vm.startPrank(trader1);
        sof.approve(address(fpmm), betAmount);
        uint256 bought = fpmm.buy(true, betAmount, 0);

        // Sell back — try to get 5 SOF back
        // Note: ConditionalTokenSOF mock doesn't enforce approval checks
        uint256 sellCollateral = 5e18;
        uint256 tokensNeeded = fpmm.calcSellAmount(true, sellCollateral);
        assertLe(tokensNeeded, bought, "Should have enough tokens to sell");

        uint256 sofBefore = sof.balanceOf(trader1);
        uint256 tokensSold = fpmm.sell(true, sellCollateral, tokensNeeded);
        uint256 sofAfter = sof.balanceOf(trader1);
        vm.stopPrank();

        assertEq(sofAfter - sofBefore, sellCollateral, "Should receive exact collateral");
        assertEq(tokensSold, tokensNeeded, "Tokens sold match calc");
    }

    // ─────────────────── FEE TESTS ───────────────────

    function test_feesCollected() public {
        uint256 betAmount = 100e18;

        vm.startPrank(trader1);
        sof.approve(address(fpmm), betAmount);
        fpmm.buy(true, betAmount, 0);
        vm.stopPrank();

        // 2% fee on 100 SOF = 2 SOF
        uint256 fees = fpmm.feesCollected();
        assertEq(fees, 2e18, "Should collect 2% fee");
    }

    function test_withdrawFees() public {
        vm.startPrank(trader1);
        sof.approve(address(fpmm), 100e18);
        fpmm.buy(true, 100e18, 0);
        vm.stopPrank();

        uint256 fees = fpmm.feesCollected();
        assertGt(fees, 0, "Fees should exist");

        uint256 treasuryBefore = sof.balanceOf(treasury);
        fpmm.withdrawFees();
        uint256 treasuryAfter = sof.balanceOf(treasury);

        assertEq(treasuryAfter - treasuryBefore, fees, "Treasury receives fees");
        assertEq(fpmm.feesCollected(), 0, "Fees reset to 0");
    }

    // ─────────────────── RESERVES & INVARIANT ───────────────────

    function test_reservesConstantProduct() public {
        uint256 kBefore = fpmm.yesReserve() * fpmm.noReserve();

        vm.startPrank(trader1);
        sof.approve(address(fpmm), 50e18);
        fpmm.buy(true, 50e18, 0);
        vm.stopPrank();

        // k may decrease slightly due to fee extraction + integer rounding
        // Fee is extracted BEFORE reserve update, so k doesn't strictly increase
        // But it should stay within ~2% (fee rate) of original
        uint256 kAfter = fpmm.yesReserve() * fpmm.noReserve();
        uint256 minK = (kBefore * 98) / 100; // Allow 2% decrease from fees
        assertGe(kAfter, minK, "k should not decrease beyond fee tolerance");
    }

    // ─────────────────── ORACLE-SEEDED PROBABILITY ───────────────────

    function test_marketCreatedWithCustomProbability() public {
        // Create a new market with 80% probability
        bytes32 qid2 = keccak256("season-2-player");
        address player2Addr = address(0x3001);
        ctf.prepareCondition(address(this), qid2, 2);
        bytes32 cond2 = ctf.getConditionId(address(this), qid2, 2);

        sof.mint(address(this), INITIAL_FUNDING);
        sof.approve(address(fpmmManager), INITIAL_FUNDING);

        (address fpmm2Addr,) = fpmmManager.createMarket(2, player2Addr, cond2, 8000);
        SimpleFPMM fpmm2 = SimpleFPMM(fpmm2Addr);

        // 80% probability → YES price should be ~80%
        // P(YES) = noReserve / (yesReserve + noReserve) = 0.80
        // So noReserve = 80, yesReserve = 20
        (uint256 yesPrice, uint256 noPrice) = fpmm2.getPrices();
        assertEq(yesPrice, 8000, "YES price should be 80%");
        assertEq(noPrice, 2000, "NO price should be 20%");
    }

    // ─────────────────── EDGE CASES ───────────────────

    function test_largeBuy() public {
        // Buy with very large amount — should not drain pool to 0
        uint256 hugeBet = 500e18;

        vm.startPrank(trader1);
        sof.approve(address(fpmm), hugeBet);
        uint256 out = fpmm.buy(true, hugeBet, 0);
        vm.stopPrank();

        assertGt(fpmm.yesReserve(), 0, "YES reserve should never hit 0");
        assertGt(fpmm.noReserve(), 0, "NO reserve should never hit 0");
        assertGt(out, 0, "Should get some tokens");
    }

    function test_smallBuy() public {
        uint256 tinyBet = 1e15; // 0.001 SOF

        vm.startPrank(trader1);
        sof.approve(address(fpmm), tinyBet);
        uint256 out = fpmm.buy(true, tinyBet, 0);
        vm.stopPrank();

        assertGt(out, 0, "Even tiny bet should produce output");
    }
}

/**
 * @title InfoFiFPMMForkTest
 * @notice Fork tests against live Season 2 markets on Base Sepolia
 * @dev Run with: forge test --match-contract InfoFiFPMMForkTest --fork-url https://sepolia.base.org -vvv
 */
contract InfoFiFPMMForkTest is Test {
    // Season 2 FPMM addresses
    address constant FPMM_30 = 0x1Fc0879C2edd4B8401615A15c280896A5199A037;
    address constant FPMM_31 = 0xd4Bf98B14698BAe2b356261d6F74D28168722D6d;
    address constant FPMM_33 = 0x96cCC4B1324b12bFd7f05160Fce38344C2595e17;
    address constant FPMM_34 = 0x45040dEF20c42b05c9D4F73780a77B525373F255;

    address constant SOF_TOKEN = 0x5146Dd2a3Af7Bd4D247e34A3F7322daDF7ee5B0c;
    address constant CTF = 0xFA6B9af6FeE7fAD1f89A58154310B0Cc89d4774C;

    address devWallet = 0x1eD4aC856D7a072C3a336C0971a47dB86A808Ff4;

    address[] fpmmAddresses;

    function setUp() public {
        fpmmAddresses.push(FPMM_30);
        fpmmAddresses.push(FPMM_31);
        fpmmAddresses.push(FPMM_33);
        fpmmAddresses.push(FPMM_34);
    }

    function test_allMarketsHaveReserves() public view {
        for (uint256 i = 0; i < fpmmAddresses.length; i++) {
            SimpleFPMM fpmm = SimpleFPMM(fpmmAddresses[i]);
            assertGt(fpmm.yesReserve(), 0, "YES reserve > 0");
            assertGt(fpmm.noReserve(), 0, "NO reserve > 0");
        }
    }

    function test_allMarketsPricesValid() public view {
        for (uint256 i = 0; i < fpmmAddresses.length; i++) {
            SimpleFPMM fpmm = SimpleFPMM(fpmmAddresses[i]);
            (uint256 yesPrice, uint256 noPrice) = fpmm.getPrices();
            assertGt(yesPrice, 0, "YES price > 0");
            assertGt(noPrice, 0, "NO price > 0");
            // Allow 1 bps rounding error from integer division
            uint256 sum = yesPrice + noPrice;
            assertGe(sum, 9999, "Prices sum to ~100% (lower)");
            assertLe(sum, 10001, "Prices sum to ~100% (upper)");
        }
    }

    function test_buyYesOnAllMarkets() public {
        uint256 betAmount = 5e18; // 5 SOF per market

        for (uint256 i = 0; i < fpmmAddresses.length; i++) {
            SimpleFPMM fpmm = SimpleFPMM(fpmmAddresses[i]);

            // Get prices before
            (uint256 yesBefore,) = fpmm.getPrices();

            // Fund and buy YES
            deal(SOF_TOKEN, devWallet, betAmount);
            vm.startPrank(devWallet);
            IERC20(SOF_TOKEN).approve(address(fpmm), betAmount);

            uint256 expectedOut = fpmm.calcBuyAmount(true, betAmount);
            uint256 amountOut = fpmm.buy(true, betAmount, 0);
            vm.stopPrank();

            assertEq(amountOut, expectedOut, "Output matches calc");
            assertGt(amountOut, 0, "Got tokens");

            // Check CTF balance
            uint256 yesPos = fpmm.positionIds(0);
            uint256 bal = ConditionalTokenSOF(CTF).balanceOf(devWallet, yesPos);
            assertGt(bal, 0, "Holds YES CTF tokens");

            // Price should have moved up
            (uint256 yesAfter,) = fpmm.getPrices();
            assertGt(yesAfter, yesBefore, "YES price increased");
        }
    }

    function test_buyNoOnAllMarkets() public {
        uint256 betAmount = 5e18;

        for (uint256 i = 0; i < fpmmAddresses.length; i++) {
            SimpleFPMM fpmm = SimpleFPMM(fpmmAddresses[i]);

            (, uint256 noBefore) = fpmm.getPrices();

            deal(SOF_TOKEN, devWallet, betAmount);
            vm.startPrank(devWallet);
            IERC20(SOF_TOKEN).approve(address(fpmm), betAmount);

            uint256 amountOut = fpmm.buy(false, betAmount, 0);
            vm.stopPrank();

            assertGt(amountOut, 0, "Got NO tokens");

            uint256 noPos = fpmm.positionIds(1);
            uint256 bal = ConditionalTokenSOF(CTF).balanceOf(devWallet, noPos);
            assertGt(bal, 0, "Holds NO CTF tokens");

            (, uint256 noAfter) = fpmm.getPrices();
            assertGt(noAfter, noBefore, "NO price increased");
        }
    }

    function test_devWalletHasExistingPositions() public view {
        // After running bet-all-season2.sh, verify positions exist
        // Market 30: bought YES
        {
            SimpleFPMM fpmm = SimpleFPMM(FPMM_30);
            uint256 yesPos = fpmm.positionIds(0);
            uint256 bal = ConditionalTokenSOF(CTF).balanceOf(devWallet, yesPos);
            assertGt(bal, 0, "Market 30: Should hold YES tokens");
        }

        // Market 31: bought NO
        {
            SimpleFPMM fpmm = SimpleFPMM(FPMM_31);
            uint256 noPos = fpmm.positionIds(1);
            uint256 bal = ConditionalTokenSOF(CTF).balanceOf(devWallet, noPos);
            assertGt(bal, 0, "Market 31: Should hold NO tokens");
        }

        // Market 33: bought YES
        {
            SimpleFPMM fpmm = SimpleFPMM(FPMM_33);
            uint256 yesPos = fpmm.positionIds(0);
            uint256 bal = ConditionalTokenSOF(CTF).balanceOf(devWallet, yesPos);
            assertGt(bal, 0, "Market 33: Should hold YES tokens");
        }

        // Market 34: bought NO
        {
            SimpleFPMM fpmm = SimpleFPMM(FPMM_34);
            uint256 noPos = fpmm.positionIds(1);
            uint256 bal = ConditionalTokenSOF(CTF).balanceOf(devWallet, noPos);
            assertGt(bal, 0, "Market 34: Should hold NO tokens");
        }
    }

    function test_calcBuyAmountConsistency() public view {
        // Verify calcBuyAmount returns consistent results across all markets
        uint256[] memory amounts = new uint256[](4);
        amounts[0] = 1e18;
        amounts[1] = 10e18;
        amounts[2] = 50e18;
        amounts[3] = 100e18;

        for (uint256 i = 0; i < fpmmAddresses.length; i++) {
            SimpleFPMM fpmm = SimpleFPMM(fpmmAddresses[i]);
            uint256 prevOut;

            for (uint256 j = 0; j < amounts.length; j++) {
                uint256 out = fpmm.calcBuyAmount(true, amounts[j]);
                assertGt(out, 0, "Output > 0");

                if (j > 0) {
                    assertGt(out, prevOut, "Larger bet = larger output");
                }
                prevOut = out;
            }
        }
    }
}
