// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {MockERC20} from "../../src/test-helpers/MockERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @notice Provides the platform's default quote token for seasons to be priced in.
 *
 * @dev Each season names its own `quoteToken`; in the finished system those are launchpad
 *      tokens. This step supplies the platform default (`QuoteToken` in the deployments
 *      JSON), which seeds InfoFi and backs the testnet pipeline end to end.
 *
 *      - `QUOTE_TOKEN_ADDRESS` set: use that token. It must be a deployed 18-decimal
 *        ERC-20. Required on any chain that is not local or Base Sepolia.
 *      - Local (31337) or Base Sepolia (84532) with no override: deploy a MockERC20
 *        placeholder. It has UNRESTRICTED minting, which is why it never deploys anywhere
 *        else — on mainnet anyone could mint it and drain every pool priced in it.
 */
contract DeployQuoteToken is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address configured = vm.envOr("QUOTE_TOKEN_ADDRESS", address(0));

        if (configured != address(0)) {
            require(configured.code.length > 0, "QuoteToken: QUOTE_TOKEN_ADDRESS has no code on this chain");
            require(IERC20Metadata(configured).decimals() == 18, "QuoteToken: QUOTE_TOKEN_ADDRESS must be 18 decimals");
            addrs.quoteToken = configured;
            console2.log("QuoteToken (configured):", configured);
            return addrs;
        }

        require(
            block.chainid == 31337 || block.chainid == 84532,
            "QuoteToken: set QUOTE_TOKEN_ADDRESS - the mintable placeholder only deploys to local and Base Sepolia"
        );

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        MockERC20 quote = new MockERC20("Placeholder Quote Token", "QUOTE", 100_000_000 ether);

        vm.stopBroadcast();

        addrs.quoteToken = address(quote);

        console2.log("QuoteToken (placeholder MockERC20, testnet only):", address(quote));

        return addrs;
    }
}
