// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {InfoFiFPMMV2} from "src/infofi/InfoFiFPMMV2.sol";
import {InfoFiMarketFactory} from "src/infofi/InfoFiMarketFactory.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title UpgradeInfoFiHybridPricing
 * @notice Redeploys InfoFiFPMMV2 + InfoFiMarketFactory with oracle-seeded initial reserves
 * @dev Only redeploys the two contracts that changed. Reuses existing:
 *      - ConditionalTokenSOF
 *      - RaffleOracleAdapter
 *      - MarketTypeRegistry
 *      - InfoFiSettlement
 *      - InfoFiPriceOracle
 *
 *      Changes:
 *      - InfoFiFPMMV2.createMarket() now accepts probabilityBps parameter
 *      - Initial FPMM reserves set proportionally to raffle probability (not 50/50)
 *      - Minimum 5% reserves on each side to prevent liquidity drain
 *      - Remainder outcome tokens sent to treasury for future use
 *      - InfoFiMarketFactory passes probability from onPositionUpdate through to FPMM manager
 */
contract UpgradeInfoFiHybridPricing is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Existing contracts (reused)
        address raffleAddress = vm.envAddress("RAFFLE_ADDRESS_TESTNET");
        address sofTokenAddress = vm.envAddress("SOF_ADDRESS_TESTNET");
        address priceOracleAddress = vm.envAddress("INFOFI_ORACLE_ADDRESS_TESTNET");
        address conditionalTokensAddress = vm.envAddress("CONDITIONAL_TOKENS_ADDRESS_TESTNET");
        address raffleOracleAdapterAddress = vm.envAddress("RAFFLE_ORACLE_ADAPTER_ADDRESS_TESTNET");
        address marketTypeRegistryAddress = vm.envAddress("MARKET_TYPE_REGISTRY_ADDRESS_TESTNET");

        console2.log("=== InfoFi Hybrid Pricing Upgrade ===");
        console2.log("Deployer:", deployer);
        console2.log("Raffle:", raffleAddress);
        console2.log("Oracle:", priceOracleAddress);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new InfoFiFPMMV2 (manager) with probabilityBps support
        console2.log("\n1. Deploying new InfoFiFPMMV2...");
        InfoFiFPMMV2 fpmmManager = new InfoFiFPMMV2(
            conditionalTokensAddress,
            sofTokenAddress,
            deployer, // treasury
            deployer  // admin
        );
        address fpmmManagerAddress = address(fpmmManager);
        console2.log("   InfoFiFPMMV2:", fpmmManagerAddress);

        // 2. Deploy new InfoFiMarketFactory
        console2.log("\n2. Deploying new InfoFiMarketFactory...");
        InfoFiMarketFactory factory = new InfoFiMarketFactory(
            raffleAddress,
            priceOracleAddress,
            raffleOracleAdapterAddress,
            fpmmManagerAddress,
            sofTokenAddress,
            marketTypeRegistryAddress,
            deployer, // treasury
            deployer  // admin
        );
        address factoryAddress = address(factory);
        console2.log("   InfoFiMarketFactory:", factoryAddress);

        // 3. Grant FACTORY_ROLE to factory on FPMM manager
        console2.log("\n3. Granting FACTORY_ROLE...");
        bytes32 FACTORY_ROLE = keccak256("FACTORY_ROLE");
        fpmmManager.grantRole(FACTORY_ROLE, factoryAddress);
        console2.log("   [OK]");

        // 4. Grant RESOLVER_ROLE to factory on RaffleOracleAdapter
        console2.log("\n4. Granting RESOLVER_ROLE on OracleAdapter...");
        bytes32 RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
        // Use low-level call since we don't import the adapter
        (bool success,) = raffleOracleAdapterAddress.call(
            abi.encodeWithSignature("grantRole(bytes32,address)", RESOLVER_ROLE, factoryAddress)
        );
        require(success, "RESOLVER_ROLE grant failed");
        console2.log("   [OK]");

        // 5. Grant PAYMASTER_ROLE to deployer (for manual testing) and backend wallet
        console2.log("\n5. Granting PAYMASTER_ROLE...");
        factory.setPaymasterAccount(deployer);
        console2.log("   Deployer: [OK]");

        // 6. Approve factory to spend SOF from treasury
        console2.log("\n6. Approving SOF spending...");
        IERC20 sofToken = IERC20(sofTokenAddress);
        sofToken.approve(factoryAddress, type(uint256).max);
        console2.log("   [OK]");

        vm.stopBroadcast();

        // Summary
        console2.log("\n=========================================");
        console2.log("HYBRID PRICING UPGRADE COMPLETE");
        console2.log("=========================================");
        console2.log("NEW InfoFiFPMMV2:", fpmmManagerAddress);
        console2.log("NEW InfoFiMarketFactory:", factoryAddress);
        console2.log("=========================================");
        console2.log("");
        console2.log("NEXT STEPS:");
        console2.log("1. Update INFOFI_FACTORY_ADDRESS_TESTNET in Railway + Vercel");
        console2.log("2. Update INFOFI_FPMM_ADDRESS_TESTNET in Railway + Vercel");
        console2.log("3. Sync ABIs to frontend + backend");
        console2.log("4. Redeploy backend on Railway");
        console2.log("5. Test: create season, buy 1% tickets, verify market creates with correct odds");
    }
}
