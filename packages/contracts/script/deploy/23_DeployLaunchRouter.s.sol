// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {TokenLaunchpad} from "../../src/launchpad/TokenLaunchpad.sol";
import {UniV4LaunchRouter} from "../../src/launchpad/UniV4LaunchRouter.sol";

/**
 * @notice Deploys the launchpad's router and makes it the one the app trades through.
 *
 * @dev The app never hardcodes a router: it reads `TokenLaunchpad.router()` and encodes
 *      against ILaunchRouter. So this step is also how a router is REPLACED — deploy the
 *      new implementation, call `setRouter`, and every client follows on its next read.
 *
 *      Needs a placer to have been set (the router resolves each token's pool through the
 *      placer that launch recorded, `launchpad.placerOf`). Skips with a log when step 22
 *      skipped for want of a PoolManager; the launchpad then advertises no router and the
 *      app shows trading as unavailable.
 */
contract DeployLaunchRouter is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        if (addrs.liquidityPlacer == address(0) || addrs.poolManager == address(0)) {
            console2.log("SKIPPED: no liquidity placer, so no pools to route. Run 22 first.");
            return addrs;
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        UniV4LaunchRouter router = new UniV4LaunchRouter(addrs.poolManager, addrs.tokenLaunchpad);
        TokenLaunchpad(addrs.tokenLaunchpad).setRouter(address(router));

        vm.stopBroadcast();

        addrs.launchRouter = address(router);

        console2.log("UniV4LaunchRouter:", address(router));
        console2.log("  set as TokenLaunchpad.router()");

        return addrs;
    }
}
