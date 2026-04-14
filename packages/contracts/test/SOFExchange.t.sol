// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFExchange} from "../src/exchange/SOFExchange.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {ISOFExchange} from "../src/exchange/ISOFExchange.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @dev Mock USDC with 6 decimals
contract MockUSDC is ERC20 {
    constructor() ERC20("USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SOFExchangeTest is Test {
    SOFToken public sofToken;
    SOFExchange public exchange;
    MockUSDC public usdc;

    address public admin = address(this);
    address public user = address(0xBEEF);

    // Rates
    uint256 public constant ETH_RATE = 10_000e18; // 10k SOF per 1 ETH
    // USDC has 6 decimals. Rate is SOF per 1e18 of token base units.
    // We want: 1 USDC (1e6 base units) => 1 SOF (1e18)
    // So for 1e18 base units of USDC => 1e12 SOF (since 1e18/1e6 = 1e12 USDC)
    // Actually: rate = SOF per 1e18 of token. 1e18 USDC base units = 1e12 USDC.
    // We want 1 USDC = 1 SOF => 1e12 USDC = 1e12 SOF => rate for 1e18 base = 1e12 SOF.
    // sofOut = (amount * rate) / 1e18. For amount=1e6 (1 USDC): sofOut = (1e6 * rate) / 1e18 = rate / 1e12
    // We want sofOut = 1e18 (1 SOF), so rate / 1e12 = 1e18 => rate = 1e30
    uint256 public constant USDC_RATE = 1e30; // 1 USDC = 1 SOF

    function setUp() public {
        // Deploy SOFToken with 0 initial supply (exchange mints on buy)
        sofToken = new SOFToken("SOF", "SOF", 0);

        // Deploy mock USDC
        usdc = new MockUSDC();

        // Deploy exchange
        exchange = new SOFExchange(address(sofToken), admin);

        // Grant MINTER_ROLE on SOFToken to the exchange
        sofToken.grantRole(sofToken.MINTER_ROLE(), address(exchange));

        // Set rates
        exchange.setRate(address(0), ETH_RATE);
        exchange.setRate(address(usdc), USDC_RATE);

        // Fund exchange with ETH reserves for sell tests
        exchange.depositReserves{value: 10 ether}();

        // Fund exchange with USDC reserves for sell tests
        usdc.mint(admin, 100_000e6);
        usdc.approve(address(exchange), type(uint256).max);
        exchange.depositTokenReserves(address(usdc), 10_000e6);

        // Give user some ETH and USDC
        vm.deal(user, 100 ether);
        usdc.mint(user, 100_000e6);

        // Set a daily sell limit
        exchange.setDailySellLimit(50_000e18); // 50k SOF per day
    }

    // ========================================================================
    // 1. test_swapETHForSOF
    // ========================================================================
    function test_swapETHForSOF() public {
        vm.startPrank(user);

        uint256 ethIn = 1 ether;
        uint256 expectedSOF = (ethIn * ETH_RATE) / 1e18; // 10_000e18

        exchange.swapETHForSOF{value: ethIn}();

        assertEq(sofToken.balanceOf(user), expectedSOF, "SOF balance mismatch");
        vm.stopPrank();
    }

    // ========================================================================
    // 2. test_swapTokenForSOF
    // ========================================================================
    function test_swapTokenForSOF() public {
        vm.startPrank(user);

        uint256 usdcIn = 100e6; // 100 USDC
        uint256 expectedSOF = (usdcIn * USDC_RATE) / 1e18; // 100e18 SOF

        usdc.approve(address(exchange), usdcIn);
        exchange.swapTokenForSOF(address(usdc), usdcIn);

        assertEq(sofToken.balanceOf(user), expectedSOF, "SOF balance mismatch");
        vm.stopPrank();
    }

    // ========================================================================
    // 3. test_swapSOFForETH
    // ========================================================================
    function test_swapSOFForETH() public {
        // First buy SOF
        vm.startPrank(user);
        exchange.swapETHForSOF{value: 1 ether}();
        uint256 sofBal = sofToken.balanceOf(user);

        uint256 sellAmount = 5000e18; // sell 5k SOF
        uint256 expectedETH = (sellAmount * 1e18) / ETH_RATE; // 0.5 ETH

        sofToken.approve(address(exchange), sellAmount);
        uint256 ethBefore = user.balance;
        exchange.swapSOFForETH(sellAmount);
        uint256 ethAfter = user.balance;

        assertEq(ethAfter - ethBefore, expectedETH, "ETH received mismatch");
        assertEq(sofToken.balanceOf(user), sofBal - sellAmount, "SOF balance mismatch");
        vm.stopPrank();
    }

    // ========================================================================
    // 4. test_swapSOFForToken
    // ========================================================================
    function test_swapSOFForToken() public {
        // First buy SOF with ETH
        vm.startPrank(user);
        exchange.swapETHForSOF{value: 1 ether}();

        uint256 sellAmount = 100e18; // sell 100 SOF
        uint256 expectedUSDC = (sellAmount * 1e18) / USDC_RATE; // 100e6

        sofToken.approve(address(exchange), sellAmount);
        uint256 usdcBefore = usdc.balanceOf(user);
        exchange.swapSOFForToken(address(usdc), sellAmount);
        uint256 usdcAfter = usdc.balanceOf(user);

        assertEq(usdcAfter - usdcBefore, expectedUSDC, "USDC received mismatch");
        vm.stopPrank();
    }

    // ========================================================================
    // 5. test_revert_zeroAmount
    // ========================================================================
    function test_revert_zeroAmount() public {
        vm.startPrank(user);

        vm.expectRevert(ISOFExchange.ZeroAmount.selector);
        exchange.swapETHForSOF{value: 0}();

        vm.expectRevert(ISOFExchange.ZeroAmount.selector);
        exchange.swapTokenForSOF(address(usdc), 0);

        vm.expectRevert(ISOFExchange.ZeroAmount.selector);
        exchange.swapSOFForETH(0);

        vm.expectRevert(ISOFExchange.ZeroAmount.selector);
        exchange.swapSOFForToken(address(usdc), 0);

        vm.stopPrank();
    }

    // ========================================================================
    // 6. test_revert_unsupportedToken
    // ========================================================================
    function test_revert_unsupportedToken() public {
        address fakeToken = address(0xDEAD);

        vm.startPrank(user);

        vm.expectRevert(ISOFExchange.UnsupportedToken.selector);
        exchange.swapTokenForSOF(fakeToken, 100);

        vm.expectRevert(ISOFExchange.UnsupportedToken.selector);
        exchange.swapSOFForToken(fakeToken, 100);

        vm.stopPrank();
    }

    // ========================================================================
    // 7. test_revert_rateNotSet
    // ========================================================================
    function test_revert_rateNotSet() public {
        // Deploy fresh exchange without rates
        SOFExchange freshExchange = new SOFExchange(address(sofToken), admin);
        sofToken.grantRole(sofToken.MINTER_ROLE(), address(freshExchange));

        vm.startPrank(user);

        vm.expectRevert(ISOFExchange.RateNotSet.selector);
        freshExchange.swapETHForSOF{value: 1 ether}();

        vm.stopPrank();
    }

    // ========================================================================
    // 8. test_dailySellLimit
    // ========================================================================
    function test_dailySellLimit() public {
        // Buy a large amount of SOF
        vm.startPrank(user);
        exchange.swapETHForSOF{value: 10 ether}(); // 100k SOF

        sofToken.approve(address(exchange), type(uint256).max);

        // Sell up to daily limit (50k SOF)
        exchange.swapSOFForETH(50_000e18);

        // Next sell should fail
        vm.expectRevert(
            abi.encodeWithSelector(ISOFExchange.DailySellLimitExceeded.selector, 1e18, 0)
        );
        exchange.swapSOFForETH(1e18);

        vm.stopPrank();
    }

    // ========================================================================
    // 9. test_dailySellLimit_resetsNextDay
    // ========================================================================
    function test_dailySellLimit_resetsNextDay() public {
        vm.startPrank(user);
        exchange.swapETHForSOF{value: 10 ether}(); // 100k SOF
        sofToken.approve(address(exchange), type(uint256).max);

        // Use up daily limit
        exchange.swapSOFForETH(50_000e18);

        // Warp 1 day forward
        vm.warp(block.timestamp + 1 days);

        // Should succeed now
        exchange.swapSOFForETH(1000e18);

        (uint256 used, uint256 remaining) = exchange.getDailyUsage(user);
        assertEq(used, 1000e18, "Daily usage mismatch");
        assertEq(remaining, 49_000e18, "Daily remaining mismatch");

        vm.stopPrank();
    }

    // ========================================================================
    // 10. test_revert_insufficientReserves
    // ========================================================================
    function test_revert_insufficientReserves() public {
        // Deploy fresh exchange with no reserves
        SOFExchange noReserveExchange = new SOFExchange(address(sofToken), admin);
        sofToken.grantRole(sofToken.MINTER_ROLE(), address(noReserveExchange));
        noReserveExchange.setRate(address(0), ETH_RATE);
        noReserveExchange.setDailySellLimit(0); // unlimited

        // Buy some SOF
        vm.startPrank(user);
        noReserveExchange.swapETHForSOF{value: 1 ether}();

        sofToken.approve(address(noReserveExchange), type(uint256).max);

        // Try to sell — exchange has received 1 ETH from the buy, but SOF was minted.
        // The exchange holds the ETH from the buy. Let's try to sell more SOF than ETH available.
        // Actually, it holds 1 ETH. Selling 10k SOF = 1 ETH. Buying gave 10k SOF.
        // To trigger insufficient reserves, we need to sell MORE than available.
        // Mint extra SOF to user directly and try to sell
        vm.stopPrank();
        sofToken.grantRole(sofToken.MINTER_ROLE(), admin);
        sofToken.mint(user, 100_000e18); // extra SOF

        vm.startPrank(user);
        // Try selling 110k SOF = 11 ETH, but exchange only has 1 ETH
        vm.expectRevert(ISOFExchange.InsufficientReserves.selector);
        noReserveExchange.swapSOFForETH(110_000e18);

        vm.stopPrank();
    }

    // ========================================================================
    // 11. test_getQuote
    // ========================================================================
    function test_getQuote() public {
        // Quote for buying SOF with ETH
        uint256 ethIn = 2 ether;
        uint256 quotedSOF = exchange.getQuote(address(0), address(sofToken), ethIn);
        uint256 expectedSOF = (ethIn * ETH_RATE) / 1e18;
        assertEq(quotedSOF, expectedSOF, "ETH->SOF quote mismatch");

        // Quote for selling SOF for ETH
        uint256 sofIn = 10_000e18;
        uint256 quotedETH = exchange.getQuote(address(sofToken), address(0), sofIn);
        uint256 expectedETH = (sofIn * 1e18) / ETH_RATE;
        assertEq(quotedETH, expectedETH, "SOF->ETH quote mismatch");

        // Verify quote matches actual swap output
        vm.startPrank(user);
        exchange.swapETHForSOF{value: ethIn}();
        assertEq(sofToken.balanceOf(user), quotedSOF, "Quote does not match actual swap");
        vm.stopPrank();
    }

    // ========================================================================
    // 12. test_setRate_onlyAdmin
    // ========================================================================
    function test_setRate_onlyAdmin() public {
        vm.startPrank(user);

        // user does not have RATE_ADMIN_ROLE
        vm.expectRevert();
        exchange.setRate(address(0), 999);

        vm.stopPrank();
    }

    // ========================================================================
    // 13. test_pause_unpause
    // ========================================================================
    function test_pause_unpause() public {
        exchange.pause();

        vm.startPrank(user);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        exchange.swapETHForSOF{value: 1 ether}();

        vm.stopPrank();

        // Unpause and verify it works again
        exchange.unpause();

        vm.startPrank(user);
        exchange.swapETHForSOF{value: 1 ether}();
        assertGt(sofToken.balanceOf(user), 0, "Swap should work after unpause");
        vm.stopPrank();
    }

    // ========================================================================
    // 14. test_depositWithdrawReserves
    // ========================================================================
    function test_depositWithdrawReserves() public {
        uint256 exchangeEthBefore = address(exchange).balance;

        // Deposit more ETH
        exchange.depositReserves{value: 5 ether}();
        assertEq(address(exchange).balance, exchangeEthBefore + 5 ether, "ETH deposit mismatch");

        // Withdraw ETH
        uint256 adminEthBefore = admin.balance;
        exchange.withdrawReserves(2 ether);
        assertEq(admin.balance, adminEthBefore + 2 ether, "ETH withdraw mismatch");

        // Deposit USDC
        uint256 exchangeUsdcBefore = usdc.balanceOf(address(exchange));
        usdc.mint(admin, 5000e6);
        usdc.approve(address(exchange), 5000e6);
        exchange.depositTokenReserves(address(usdc), 5000e6);
        assertEq(usdc.balanceOf(address(exchange)), exchangeUsdcBefore + 5000e6, "USDC deposit mismatch");

        // Withdraw USDC
        uint256 adminUsdcBefore = usdc.balanceOf(admin);
        exchange.withdrawTokenReserves(address(usdc), 1000e6);
        assertEq(usdc.balanceOf(admin), adminUsdcBefore + 1000e6, "USDC withdraw mismatch");
    }

    // Allow this test contract to receive ETH
    receive() external payable {}
}
