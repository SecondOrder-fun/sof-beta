// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {MockERC20} from "../../src/test-helpers/MockERC20.sol";

/**
 * @notice Deploys a placeholder quote token for seasons to be priced in.
 *
 * @dev Replaces 01_DeploySOFToken. There is no protocol token any more — each season
 *      names its own `quoteToken`, and in the finished system those are launchpad tokens.
 *      Until the launchpad exists there is nothing to quote seasons in, so this deploys a
 *      MockERC20 to keep the dev and testnet pipeline usable end to end.
 *
 *      THIS IS A PLACEHOLDER. Once the launchpad ships, seasons should be quoted in real
 *      launched tokens and this step should be dropped from DeployAll on
 *      testnet/mainnet. It has unrestricted minting.
 */
contract DeployQuoteToken is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        MockERC20 quote = new MockERC20("Placeholder Quote Token", "QUOTE", 100_000_000 ether);

        vm.stopBroadcast();

        addrs.quoteToken = address(quote);

        console2.log("QuoteToken (placeholder MockERC20):", address(quote));

        return addrs;
    }
}
