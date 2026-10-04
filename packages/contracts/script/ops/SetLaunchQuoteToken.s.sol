// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {TokenLaunchpad} from "../../src/launchpad/TokenLaunchpad.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// @title SetLaunchQuoteToken
/// @notice Allowlists an ERC-20 as a launch quote token on TokenLaunchpad, with its
///         opening-valuation (FDV) bounds — or removes one.
///
/// @dev The bounds are in the quote token's RAW units, like deploy step 21's ETH
///      bounds in wei. For USDC (6 decimals) a 2,500 USDC floor is MIN_FDV=2500000000.
///
///      Only plain ERC-20s belong on the list: no fee-on-transfer, rebasing or
///      callback tokens. The pool's accounting and the router assume neither, and a
///      launch paired with such a token can lock its market. Check the token before
///      running this; the script cannot.
///
/// Env:
///   TOKEN_LAUNCHPAD_ADDRESS  the launchpad (CONFIG_ROLE holder signs)
///   QUOTE_TOKEN              the ERC-20 to allow or remove
///   MIN_FDV, MAX_FDV         opening-FDV bounds in QUOTE_TOKEN raw units (allow only)
///   REMOVE                   "true" to remove QUOTE_TOKEN instead (optional)
///   PRIVATE_KEY              a CONFIG_ROLE holder on the launchpad
contract SetLaunchQuoteToken is Script {
    function run() external {
        TokenLaunchpad launchpad = TokenLaunchpad(vm.envAddress("TOKEN_LAUNCHPAD_ADDRESS"));
        address quote = vm.envAddress("QUOTE_TOKEN");
        bool remove = vm.envOr("REMOVE", false);
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(quote != address(0), "SetLaunchQuoteToken: QUOTE_TOKEN is native ETH; it is set at deploy");
        require(quote.code.length != 0, "SetLaunchQuoteToken: QUOTE_TOKEN has no code");

        if (remove) {
            vm.startBroadcast(key);
            launchpad.removeQuoteToken(quote);
            vm.stopBroadcast();
            console2.log("SetLaunchQuoteToken: removed", quote);
            return;
        }

        uint256 minFdv = vm.envUint("MIN_FDV");
        uint256 maxFdv = vm.envUint("MAX_FDV");

        vm.startBroadcast(key);
        launchpad.setQuoteToken(quote, minFdv, maxFdv);
        vm.stopBroadcast();

        console2.log("SetLaunchQuoteToken:", IERC20Decimals(quote).symbol(), quote);
        console2.log("  decimals:", IERC20Decimals(quote).decimals());
        console2.log("  start-FDV range (raw):", minFdv, "..", maxFdv);
    }
}
