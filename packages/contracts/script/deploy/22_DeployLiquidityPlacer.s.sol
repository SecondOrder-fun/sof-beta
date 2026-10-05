// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {TokenLaunchpad} from "../../src/launchpad/TokenLaunchpad.sol";
import {UniV4LiquidityPlacer, PLACER_HOOK_FLAGS} from "../../src/launchpad/UniV4LiquidityPlacer.sol";
import {HookMiner} from "../../src/launchpad/HookMiner.sol";

/**
 * @notice Deploys the Uniswap v4 liquidity placer — which is also every launch pool's
 *         hook — and wires it into the launchpad.
 *
 * @dev Closes the circular dependency opened by 21_DeployTokenLaunchpad: the placer takes
 *      the launchpad address immutably, then `setPlacer` hands the launchpad the placer.
 *
 *      v4 reads a hook's permissions from its address, so the placer is deployed with
 *      CREATE2 at a salt mined (`HookMiner`) for exactly `PLACER_HOOK_FLAGS`.
 *      Broadcast CREATE2 goes through the standard CREATE2 factory, so it is mined against
 *      that deployer; the constructor re-checks the address.
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
    /// @notice The lowest trade fee a creator may choose, in pips (5_000 = 0.5%). The
    ///         ceiling is the placer's compiled-in MAX_TRADE_FEE (10%).
    /// @dev The fee is the launchpad's revenue (split 88/12 creator/platform, design.md
    ///      §6.7), so a floor keeps every launch paying something. CONFIG_ROLE-adjustable.
    uint24 internal constant MIN_TRADE_FEE = 5_000;

    /// @notice Tick spacing. Must divide the position's ticks.
    int24 internal constant TICK_SPACING = 200;

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

        bytes memory initCode = abi.encodePacked(
            type(UniV4LiquidityPlacer).creationCode,
            abi.encode(poolManager, addrs.tokenLaunchpad, admin, TICK_SPACING, MIN_TRADE_FEE)
        );
        (address expected, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, PLACER_HOOK_FLAGS, initCode);

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        UniV4LiquidityPlacer placer =
            new UniV4LiquidityPlacer{salt: salt}(poolManager, addrs.tokenLaunchpad, admin, TICK_SPACING, MIN_TRADE_FEE);
        require(address(placer) == expected, "LiquidityPlacer: landed at an unexpected address");

        // The launchpad's half of the circular dependency. Deployer holds CONFIG_ROLE from
        // the launchpad's constructor.
        TokenLaunchpad(payable(addrs.tokenLaunchpad)).setPlacer(address(placer));

        // The platform's 12% of trade fees. TREASURY_ADDRESS, as step 16c uses; the
        // deployer when unset (local).
        address feeTreasury = vm.envOr("TREASURY_ADDRESS", admin);
        placer.setFeeTreasury(feeTreasury);

        vm.stopBroadcast();

        addrs.liquidityPlacer = address(placer);

        console2.log("UniV4LiquidityPlacer (pool hook):", address(placer));
        console2.log("  PoolManager:", poolManager);
        console2.log("  min trade fee (pips) / tickSpacing:", MIN_TRADE_FEE, uint256(int256(TICK_SPACING)));
        console2.log("  wired into TokenLaunchpad:", addrs.tokenLaunchpad);
        console2.log("  trade fee treasury (12%):", feeTreasury);

        return addrs;
    }
}
