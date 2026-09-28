// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {TokenLaunchpad} from "../../src/launchpad/TokenLaunchpad.sol";
import {UniV4LiquidityPlacer} from "../../src/launchpad/UniV4LiquidityPlacer.sol";

/**
 * @notice Deploys the Uniswap v4 liquidity placer and wires it into the launchpad.
 *
 * @dev Closes the circular dependency opened by 21_DeployTokenLaunchpad: the placer takes
 *      the launchpad address immutably, then `setPlacer` hands the launchpad the placer.
 *
 *      Requires a PoolManager. Locally 20_DeployPoolManager has already put one in `addrs`;
 *      elsewhere it comes from HelperConfig.getPoolManager() (POOL_MANAGER_ADDRESS, else the
 *      checked-in deployments file). With neither, this step is SKIPPED rather than failing
 *      the whole deploy — everything before it is independent of the launchpad, and a chain
 *      without a v4 deployment should still get a working raffle stack. The launchpad is
 *      then left with no placer, so `launch()` reverts `PlacerNotSet` until someone runs
 *      this step with the address supplied.
 */
contract DeployLiquidityPlacer is Script {
    /// @notice Pool fee, in hundredths of a bip. 10_000 = 1%.
    /// @dev High by AMM standards and deliberately so: the fee is the launchpad's revenue
    ///      (split 88/12 creator/platform, design.md §6.7) and launch tokens trade on
    ///      volatility, not on tight spreads. It matches what Clanker charges.
    uint24 internal constant POOL_FEE = 10_000;

    /// @notice Tick spacing. Must divide the position's ticks.
    int24 internal constant TICK_SPACING = 200;

    /// @notice How far below the start price the position extends.
    /// @dev 1.0001**46_000 is roughly 100x, so the token can climb about two orders of
    ///      magnitude before the position is fully sold and the supply is entirely in
    ///      buyers' hands. Wide enough that no realistic launch exhausts it; narrow enough
    ///      that the price actually moves on ordinary volume.
    int24 internal constant RANGE_WIDTH_TICKS = 46_000;

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        require(addrs.tokenLaunchpad != address(0), "LiquidityPlacer: launchpad must be deployed first");

        address poolManager = addrs.poolManager;
        if (poolManager == address(0)) {
            poolManager = new HelperConfig().getPoolManager();
            addrs.poolManager = poolManager;
        }

        if (poolManager == address(0)) {
            console2.log("SKIPPED: no Uniswap v4 PoolManager for this chain.");
            console2.log("  Set POOL_MANAGER_ADDRESS, or add .contracts.PoolManager to the deployments file,");
            console2.log("  then re-run 22_DeployLiquidityPlacer. Until then TokenLaunchpad.launch() reverts.");
            return addrs;
        }

        address admin = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        UniV4LiquidityPlacer placer = new UniV4LiquidityPlacer(
            poolManager, addrs.tokenLaunchpad, admin, POOL_FEE, TICK_SPACING, RANGE_WIDTH_TICKS
        );

        // The launchpad's half of the circular dependency. Deployer holds CONFIG_ROLE from
        // the launchpad's constructor.
        TokenLaunchpad(addrs.tokenLaunchpad).setPlacer(address(placer));

        vm.stopBroadcast();

        addrs.liquidityPlacer = address(placer);

        console2.log("UniV4LiquidityPlacer:", address(placer));
        console2.log("  PoolManager:", poolManager);
        console2.log("  fee / tickSpacing / rangeWidth:", POOL_FEE, uint256(int256(TICK_SPACING)));
        console2.log("  wired into TokenLaunchpad:", addrs.tokenLaunchpad);

        return addrs;
    }
}
