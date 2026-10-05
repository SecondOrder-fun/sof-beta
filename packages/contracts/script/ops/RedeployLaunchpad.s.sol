// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "../deploy/DeployedAddresses.sol";
import {HelperConfig} from "../deploy/HelperConfig.s.sol";
import {DeployTokenLaunchpad} from "../deploy/21_DeployTokenLaunchpad.s.sol";
import {DeployLiquidityPlacer} from "../deploy/22_DeployLiquidityPlacer.s.sol";
import {DeployLaunchRouter} from "../deploy/23_DeployLaunchRouter.s.sol";
import {TokenLaunchpad} from "../../src/launchpad/TokenLaunchpad.sol";
import {Raffle} from "../../src/core/Raffle.sol";

interface IERC20Meta {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// @title RedeployLaunchpad
/// @notice Replaces the launchpad stack (deploy steps 21–23) on a chain whose raffle stack
///         stays put: a new TokenLaunchpad, UniV4LiquidityPlacer + LaunchPoolGate and
///         UniV4LaunchRouter, with `Raffle.setLaunchpad` pointed at the new launchpad.
///         Optionally allowlists one ERC-20 launch quote token in the same broadcast.
///
/// @dev For a launchpad whose interface changed (a new `launch` signature, events, the
///      fee ledger), where an in-place `setRouter` / `setPlacer` cannot carry the change.
///      Launches made on the old launchpad keep their pools and LP positions under the
///      old placer; the app stops listing them once it reads the new launchpad.
///
///      Raffle and the v4 PoolManager are read from deployments/<network>.json (the
///      PoolManager via HelperConfig, so POOL_MANAGER_ADDRESS still overrides). Run
///      `scripts/extract-deployment-addresses.js --network <n> --script RedeployLaunchpad.s.sol`
///      afterwards: it overlays the new addresses on the deployments file.
///
/// Env:
///   PRIVATE_KEY            DEFAULT_ADMIN_ROLE on Raffle; becomes the launchpad's admin
///   TREASURY_ADDRESS       the placer's 12% LP-fee treasury (deployer when unset)
///   LAUNCH_QUOTE_TOKEN     ERC-20 to allowlist as a quote token (optional)
///   LAUNCH_QUOTE_MIN_FDV   its opening-FDV floor, raw units (required with the token)
///   LAUNCH_QUOTE_MAX_FDV   its opening-FDV ceiling, raw units (required with the token)
contract RedeployLaunchpad is Script {
    function run() external returns (DeployedAddresses memory addrs) {
        HelperConfig config = new HelperConfig();
        string memory json = vm.readFile(config.getDeploymentFilePath());

        addrs.raffle = vm.parseJsonAddress(json, ".contracts.Raffle");
        addrs.poolManager = config.getPoolManager();
        require(addrs.raffle.code.length != 0, "RedeployLaunchpad: no Raffle code at the recorded address");
        require(addrs.poolManager.code.length != 0, "RedeployLaunchpad: no PoolManager code at the resolved address");

        // Fail before broadcasting anything if the key cannot re-point the raffle.
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        require(
            Raffle(addrs.raffle).hasRole(bytes32(0), deployer),
            "RedeployLaunchpad: PRIVATE_KEY lacks DEFAULT_ADMIN_ROLE on Raffle"
        );

        address quote = vm.envOr("LAUNCH_QUOTE_TOKEN", address(0));
        uint256 minFdv;
        uint256 maxFdv;
        if (quote != address(0)) {
            require(quote.code.length != 0, "RedeployLaunchpad: LAUNCH_QUOTE_TOKEN has no code");
            minFdv = vm.envUint("LAUNCH_QUOTE_MIN_FDV");
            maxFdv = vm.envUint("LAUNCH_QUOTE_MAX_FDV");
        }

        console2.log("=== 21: TokenLaunchpad (+ Raffle.setLaunchpad) ===");
        addrs = new DeployTokenLaunchpad().run(addrs);
        console2.log("=== 22: UniV4LiquidityPlacer + LaunchPoolGate ===");
        addrs = new DeployLiquidityPlacer().run(addrs);
        require(addrs.liquidityPlacer != address(0), "RedeployLaunchpad: placer step skipped");
        console2.log("=== 23: UniV4LaunchRouter ===");
        addrs = new DeployLaunchRouter().run(addrs);
        require(addrs.launchRouter != address(0), "RedeployLaunchpad: router step skipped");

        if (quote != address(0)) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
            TokenLaunchpad(payable(addrs.tokenLaunchpad)).setQuoteToken(quote, minFdv, maxFdv);
            vm.stopBroadcast();
            console2.log("=== Quote token allowlisted:", IERC20Meta(quote).symbol(), quote);
            console2.log("  decimals:", IERC20Meta(quote).decimals());
            console2.log("  start-FDV range (raw):", minFdv, "..", maxFdv);
        }

        require(
            address(Raffle(addrs.raffle).launchpad()) == addrs.tokenLaunchpad,
            "RedeployLaunchpad: raffle not re-pointed"
        );
        console2.log("Raffle.launchpad():", addrs.tokenLaunchpad);
    }
}
