// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {MockUSDC} from "../../src/test-helpers/MockUSDC.sol";
import {HelperConfig} from "./HelperConfig.s.sol";

/// @notice Deploys the local USDC mock so the SOFExchange has a sibling token
///         to quote against. On testnet/mainnet the real USDC address must be
///         hand-set in `deployments/{network}.json` until HelperConfig grows a
///         USDC field per network.
contract DeployUSDCMock is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        HelperConfig.NetworkConfig memory networkConfig = new HelperConfig().getNetworkConfig();

        if (!networkConfig.isLocal) {
            console2.log("Skipping USDCMock on non-local network");
            return addrs;
        }

        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        MockUSDC usdc = new MockUSDC();
        // Mint 10M USDC to deployer for reserve seeding + dev wallet funding.
        usdc.mint(deployer, 10_000_000 * 10 ** 6);
        vm.stopBroadcast();

        addrs.usdc = address(usdc);
        console2.log("MockUSDC:", address(usdc));
        return addrs;
    }
}
