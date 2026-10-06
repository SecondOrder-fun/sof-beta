// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {DeployedAddresses} from "../script/deploy/DeployedAddresses.sol";
import {DeployPoolManager} from "../script/deploy/20_DeployPoolManager.s.sol";
import {DeployTokenLaunchpad} from "../script/deploy/21_DeployTokenLaunchpad.s.sol";
import {DeployLiquidityPlacer} from "../script/deploy/22_DeployLiquidityPlacer.s.sol";
import {DeployLaunchRouter} from "../script/deploy/23_DeployLaunchRouter.s.sol";
import {ILaunchRouter} from "../src/launchpad/ILaunchRouter.sol";
import {TokenLaunchpad, PlacerNotSet, StartFdvOutOfRange} from "../src/launchpad/TokenLaunchpad.sol";
import {UniV4LiquidityPlacer} from "../src/launchpad/UniV4LiquidityPlacer.sol";

/// @notice The launchpad deploy steps, run as the orchestrator runs them.
///
///         Worth testing rather than trusting, for two reasons. The launchpad and the placer
///         depend on each other, and the deploy resolves that by leaving one half unset and
///         closing it with a setter — so a silent failure leaves a launchpad that reverts on
///         every launch. And the starting-price bounds are numbers a human picked in FDV and
///         wrote as a price, nine orders of magnitude away; nothing but an assertion catches
///         a slipped factor.
contract LaunchpadDeployWiringTest is Test {
    // Anvil account #0 — the key the local deploy uses.
    uint256 internal constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    uint256 internal constant EXPECTED_MIN_FDV = 1 ether;
    uint256 internal constant EXPECTED_MAX_FDV = 1000 ether;

    address internal deployer;
    address internal buyer = address(0xB0B);
    uint24 internal constant TEST_TRADE_FEE = 10_000; // 1%

    function setUp() public {
        deployer = vm.addr(DEPLOYER_KEY);
        vm.setEnv("PRIVATE_KEY", vm.toString(DEPLOYER_KEY));
        vm.chainId(31337);
    }

    function _ethFdvBounds(TokenLaunchpad launchpad) internal view returns (uint256 minFdv, uint256 maxFdv) {
        (, minFdv, maxFdv) = launchpad.quoteConfig(address(0));
    }

    /// Runs steps 20-22 in order, as DeployAll does on a local chain.
    function _runLocalLaunchpadDeploy() internal returns (DeployedAddresses memory addrs) {
        addrs = new DeployPoolManager().run(addrs);
        addrs = new DeployTokenLaunchpad().run(addrs);
        addrs = new DeployLiquidityPlacer().run(addrs);
        addrs = new DeployLaunchRouter().run(addrs);
    }

    // ------------------------------------------------------------------
    // The wiring closes
    // ------------------------------------------------------------------

    function test_deployWiresLaunchpadAndPlacerToEachOther() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();

        assertTrue(addrs.poolManager != address(0), "PoolManager deployed locally");
        assertTrue(addrs.tokenLaunchpad != address(0), "launchpad deployed");
        assertTrue(addrs.liquidityPlacer != address(0), "placer deployed");

        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));
        UniV4LiquidityPlacer placer = UniV4LiquidityPlacer(payable(addrs.liquidityPlacer));

        // Both halves of the circular dependency.
        assertEq(address(launchpad.placer()), addrs.liquidityPlacer, "launchpad points at the placer");
        assertEq(placer.launchpad(), addrs.tokenLaunchpad, "placer points back at the launchpad");
        assertEq(address(placer.poolManager()), addrs.poolManager);
        // Trade fees cannot be collected without somewhere to send the platform's share.
        assertTrue(placer.feeTreasury() != address(0), "fee treasury set");
        // The placer is every launch pool's hook, so it must sit at a mined address.
        assertEq(uint160(addrs.liquidityPlacer) & ((1 << 14) - 1), placer.HOOK_FLAGS(), "hook address flags");
        assertEq(placer.minTradeFee(), 5_000, "0.5% trade-fee floor");
        assertEq(placer.snipeStartBps(), 8_000, "snipe tax starts at 80%");
        assertEq(placer.snipeDuration(), 30, "and decays over 30 seconds");
    }

    function test_deployerHoldsTheAdminRolesOnBoth() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();
        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));
        UniV4LiquidityPlacer placer = UniV4LiquidityPlacer(payable(addrs.liquidityPlacer));

        assertTrue(launchpad.hasRole(launchpad.CONFIG_ROLE(), deployer));
        assertTrue(launchpad.hasRole(launchpad.EMERGENCY_ROLE(), deployer));
        assertTrue(placer.hasRole(placer.CONFIG_ROLE(), deployer));
    }

    /// The point of the whole chain: after the deploy, a launch works.
    function test_launchWorksEndToEndAfterDeploy() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();
        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));

        (uint256 minFdv,) = _ethFdvBounds(launchpad);
        vm.prank(buyer);
        (, address token) = launchpad.launch("Deployed", "DPLY", "ipfs://m", address(0), minFdv, TEST_TRADE_FEE, 0, 0);

        assertGt(IERC20(token).balanceOf(addrs.poolManager), 0, "supply reached the pool");
        assertEq(IERC20(token).balanceOf(addrs.tokenLaunchpad), 0, "launchpad kept nothing");
        assertTrue(launchpad.isLaunchToken(token));
    }

    /// The app reads the router from the launchpad, so the deploy must leave it pointed
    /// at a working one — and a trade through it must land.
    function test_deployLeavesTheLaunchpadAdvertisingAWorkingRouter() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();
        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));
        assertEq(address(launchpad.router()), addrs.launchRouter, "launchpad advertises the router");

        (uint256 minFdv,) = _ethFdvBounds(launchpad);
        vm.prank(buyer);
        (, address token) = launchpad.launch("Routed", "RTD", "", address(0), minFdv, TEST_TRADE_FEE, 0, 0);

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        uint256 out = ILaunchRouter(address(launchpad.router())).buy{value: 0.1 ether}(
            token, 0.1 ether, 1, buyer, block.timestamp
        );
        assertGt(out, 0);
        assertEq(IERC20(token).balanceOf(buyer), out);
    }

    // ------------------------------------------------------------------
    // The bounds, in the unit they were chosen in
    // ------------------------------------------------------------------

    /// If someone edits the bounds as wei and slips a zero, this is what catches it.
    function test_boundsAreTheIntendedFdvRange() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();
        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));

        (bool allowed, uint256 minFdv, uint256 maxFdv) = launchpad.quoteConfig(address(0));
        assertTrue(allowed, "ETH is the default quote token");
        assertEq(minFdv, EXPECTED_MIN_FDV, "floor is a 1 ETH valuation");
        assertEq(maxFdv, EXPECTED_MAX_FDV, "ceiling is a 1000 ETH valuation");
    }

    /// The failure the floor exists to prevent: an FDV of 0.001 ETH (1e6 wei/token), where
    /// a single 0.1 ETH buy consumes the entire position. The deployed floor must exclude it.
    function test_theFdvThatBreaksPlacementIsBelowTheFloor() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();
        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));

        uint256 pathological = 0.001 ether;
        (uint256 minFdv, uint256 maxFdv) = _ethFdvBounds(launchpad);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(StartFdvOutOfRange.selector, pathological, minFdv, maxFdv));
        launchpad.launch("TooCheap", "CHEAP", "", address(0), pathological, TEST_TRADE_FEE, 0, 0);
    }

    /// Both bounds are reachable: a price exactly at each end must place successfully. A
    /// bound the placer cannot actually handle would be worse than no bound.
    function test_bothBoundsArePlaceable() public {
        DeployedAddresses memory addrs = _runLocalLaunchpadDeploy();
        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));

        (uint256 minFdv, uint256 maxFdv) = _ethFdvBounds(launchpad);
        vm.startPrank(buyer);
        (, address atFloor) = launchpad.launch("Floor", "FLR", "", address(0), minFdv, TEST_TRADE_FEE, 0, 0);
        (, address atCeiling) = launchpad.launch("Ceiling", "CEIL", "", address(0), maxFdv, TEST_TRADE_FEE, 0, 0);
        vm.stopPrank();

        assertGt(IERC20(atFloor).balanceOf(addrs.poolManager), 0);
        assertGt(IERC20(atCeiling).balanceOf(addrs.poolManager), 0);
    }

    // ------------------------------------------------------------------
    // The no-PoolManager path
    // ------------------------------------------------------------------

    /// On a chain with no v4 deployment and no POOL_MANAGER_ADDRESS, step 22 must skip
    /// rather than fail the deploy — the raffle stack does not depend on the launchpad.
    /// The launchpad is then unusable, loudly, until someone supplies the address.
    function test_placerStepSkipsWhenNoPoolManagerIsAvailable() public {
        vm.setEnv("POOL_MANAGER_ADDRESS", "");

        DeployedAddresses memory addrs;
        addrs = new DeployTokenLaunchpad().run(addrs);
        addrs = new DeployLiquidityPlacer().run(addrs);

        assertEq(addrs.liquidityPlacer, address(0), "no placer deployed");
        assertEq(addrs.poolManager, address(0), "nothing resolved");

        TokenLaunchpad launchpad = TokenLaunchpad(payable(addrs.tokenLaunchpad));
        assertEq(address(launchpad.placer()), address(0));

        // Read the bound up front: expectRevert applies to the very next call, and an
        // argument that is itself a call would swallow it.
        (uint256 minFdv,) = _ethFdvBounds(launchpad);

        vm.prank(buyer);
        vm.expectRevert(PlacerNotSet.selector);
        launchpad.launch("Unusable", "UNUS", "", address(0), minFdv, TEST_TRADE_FEE, 0, 0);
    }

    /// POOL_MANAGER_ADDRESS is how a new chain is brought up, so it must be the thing the
    /// placer actually gets built against.
    function test_poolManagerComesFromTheEnvironmentWhenSet() public {
        DeployedAddresses memory bootstrap;
        bootstrap = new DeployPoolManager().run(bootstrap);
        vm.setEnv("POOL_MANAGER_ADDRESS", vm.toString(bootstrap.poolManager));

        DeployedAddresses memory addrs;
        addrs = new DeployTokenLaunchpad().run(addrs);
        addrs = new DeployLiquidityPlacer().run(addrs);

        assertEq(addrs.poolManager, bootstrap.poolManager, "env address was used");
        assertEq(address(UniV4LiquidityPlacer(payable(addrs.liquidityPlacer)).poolManager()), bootstrap.poolManager);
    }

    function test_placerStepRefusesToRunBeforeTheLaunchpad() public {
        DeployedAddresses memory addrs;
        // Constructed first — expectRevert applies to the next call, and `new` is one.
        DeployLiquidityPlacer step = new DeployLiquidityPlacer();

        vm.expectRevert("LiquidityPlacer: launchpad must be deployed first");
        step.run(addrs);
    }
}
