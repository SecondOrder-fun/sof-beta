// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {TokenLaunchpad} from "../../src/launchpad/TokenLaunchpad.sol";

/**
 * @notice Deploys the TokenLaunchpad with its starting-price bounds.
 *
 * @dev The launchpad is deployed with `placer = address(0)` and wired afterwards by
 *      22_DeployLiquidityPlacer. The dependency is circular — the placer needs the
 *      launchpad's address to enforce `onlyLaunchpad`, and the launchpad needs the placer's
 *      to place supply — and the placer is the side that takes it immutably, so the
 *      launchpad goes first and accepts its half by setter. `launch()` reverts with
 *      `PlacerNotSet` in between, so a half-finished deploy cannot be used.
 *
 *      ## The bounds are set as FDV, not as a price
 *
 *      Every launch mints the same 1e9 tokens, so a starting price is only meaningful
 *      multiplied by that supply: `startPriceWei * 1e9` is the implied fully-diluted
 *      valuation in wei. Price and FDV are nine orders of magnitude apart, which is a very
 *      easy factor to lose. So the numbers below are written as valuations and converted,
 *      rather than written as prices and hoped about.
 *
 *      That is not a theoretical tidiness. At 1e6 wei/token — a plausible-looking
 *      "small" price — the implied FDV is 0.001 ETH, and one 0.1 ETH buy consumes the
 *      entire position and drives the pool to MIN_TICK. The launch would be over before a
 *      second buyer arrived. The floor exists to make that unreachable.
 */
contract DeployTokenLaunchpad is Script {
    /// @dev Whole tokens minted per launch. Asserted against the deployed constant below,
    ///      so changing TOKEN_SUPPLY without revisiting these bounds fails the deploy
    ///      rather than silently shifting every valuation by the same factor.
    uint256 internal constant WHOLE_SUPPLY = 1_000_000_000;

    /// @notice Cheapest launch: a 1 ETH valuation.
    /// @dev Below roughly this, a single ordinary retail buy is a large fraction of the
    ///      whole position and the price curve stops being a curve. 1 ETH is where the
    ///      behaviour verified in test/UniV4LiquidityPlacer.t.sol is sane.
    uint256 internal constant MIN_FDV_WEI = 1 ether;

    /// @notice Dearest launch: a 1000 ETH valuation.
    /// @dev A ceiling is the weaker of the two bounds — launching at an absurd valuation
    ///      mostly punishes the creator, who then owns a token nobody buys. It is here to
    ///      keep the discovery feed comparable and to stop fat-finger launches at valuations
    ///      no one could move. Both bounds are CONFIG_ROLE-adjustable after deploy.
    uint256 internal constant MAX_FDV_WEI = 1000 ether;

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address admin = vm.addr(vm.envUint("PRIVATE_KEY"));

        uint256 minStartPriceWei = MIN_FDV_WEI / WHOLE_SUPPLY;
        uint256 maxStartPriceWei = MAX_FDV_WEI / WHOLE_SUPPLY;

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // placer left unset — 22_DeployLiquidityPlacer calls setPlacer once it exists.
        TokenLaunchpad launchpad = new TokenLaunchpad(admin, address(0), minStartPriceWei, maxStartPriceWei);

        vm.stopBroadcast();

        require(
            launchpad.TOKEN_SUPPLY() / 1e18 == WHOLE_SUPPLY,
            "TokenLaunchpad: TOKEN_SUPPLY changed, revisit the FDV bounds in this script"
        );

        addrs.tokenLaunchpad = address(launchpad);

        console2.log("TokenLaunchpad:", address(launchpad));
        console2.log("  min start price (wei/token):", minStartPriceWei);
        console2.log("  max start price (wei/token):", maxStartPriceWei);
        console2.log("  => implied FDV range (wei):", MIN_FDV_WEI, "..", MAX_FDV_WEI);

        return addrs;
    }
}
