// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {InfoFiFPMMV2} from "src/infofi/InfoFiFPMMV2.sol";
import {ConditionalTokenSOF} from "src/infofi/ConditionalTokenSOF.sol";
import {MarketTypeRegistry} from "src/infofi/MarketTypeRegistry.sol";
import {InfoFiSettlement} from "src/infofi/InfoFiSettlement.sol";
import {InfoFiMarketFactory} from "src/infofi/InfoFiMarketFactory.sol";
import {RaffleOracleAdapter} from "src/infofi/RaffleOracleAdapter.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployInfoFiSepolia
 * @notice Deployment script for InfoFi system on Base Sepolia testnet
 * @dev This script assumes the core raffle system (SOF, Raffle, SeasonFactory, BondingCurve, etc.)
 *      has already been deployed by 00_DeployToSepolia.s.sol and that the following env vars are set:
 *
 *      - RAFFLE_ADDRESS_TESTNET
 *      - SOF_ADDRESS_TESTNET
 *      - INFOFI_ORACLE_ADDRESS_TESTNET
 *      - RAFFLE_ORACLE_ADAPTER_ADDRESS_TESTNET
 *
 *      For testnet we use the deployer as both admin and treasury. For mainnet production we
 *      recommend a dedicated Liquidity Provider / treasury wallet instead of the deployer.
 */
contract DeployInfoFiSepolia is Script {
    // Deployed contract addresses
    address public conditionalTokensAddress;
    address public fpmmManagerAddress;
    address public marketTypeRegistryAddress;
    address public infoFiSettlementAddress;
    address public infoFiMarketFactoryAddress;
    address public raffleOracleAdapterAddress;

    // External dependencies
    address public raffleAddress;
    address public sofTokenAddress;
    address public priceOracleAddress;

    function run() public {
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying InfoFi system from:", deployer);
        console2.log("Chain ID:", block.chainid);

        // Read existing raffle system + oracle wiring from environment
        raffleAddress = vm.envAddress("RAFFLE_ADDRESS_TESTNET");
        sofTokenAddress = vm.envAddress("SOF_ADDRESS_TESTNET");
        priceOracleAddress = vm.envAddress("INFOFI_ORACLE_ADDRESS_TESTNET");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ConditionalTokenSOF (local CTF implementation)
        console2.log("\nDeploying ConditionalTokenSOF...");
        ConditionalTokenSOF conditionalTokens = new ConditionalTokenSOF();
        conditionalTokensAddress = address(conditionalTokens);
        console2.log("ConditionalTokenSOF deployed:");
        console2.log(conditionalTokensAddress);

        // 2. Deploy RaffleOracleAdapter (bridges raffle outcome to Conditional Tokens)
        console2.log("\nDeploying RaffleOracleAdapter...");
        // For testnet we use deployer as admin/resolver. For mainnet, you may want a separate
        // resolver role holder or governance-controlled address.
        RaffleOracleAdapter raffleOracleAdapter = new RaffleOracleAdapter(conditionalTokensAddress, deployer);
        raffleOracleAdapterAddress = address(raffleOracleAdapter);
        console2.log("RaffleOracleAdapter deployed:");
        console2.log(raffleOracleAdapterAddress);

        // 3. Deploy InfoFiFPMMV2 (FPMM manager)
        console2.log("\nDeploying InfoFiFPMMV2 (FPMM manager)...");
        // For testnet we use deployer as both treasury and admin. For mainnet, prefer a dedicated
        // LP / treasury wallet instead of the deployer.
        InfoFiFPMMV2 fpmmManager = new InfoFiFPMMV2(
            conditionalTokensAddress,
            sofTokenAddress,
            deployer, // treasury (testnet)
            deployer // admin
        );
        fpmmManagerAddress = address(fpmmManager);
        console2.log("InfoFiFPMMV2 deployed:");
        console2.log(fpmmManagerAddress);

        // 4. Deploy MarketTypeRegistry (market type metadata)
        console2.log("\nDeploying MarketTypeRegistry...");
        MarketTypeRegistry marketRegistry = new MarketTypeRegistry(deployer);
        marketTypeRegistryAddress = address(marketRegistry);
        console2.log("MarketTypeRegistry deployed:");
        console2.log(marketTypeRegistryAddress);

        // 5. Deploy InfoFiSettlement (MVP settlement marker)
        console2.log("\nDeploying InfoFiSettlement...");
        // Use deployer as ADMIN_ROLE and raffle as SETTLER_ROLE so raffle / backend can
        // mark markets as settled.
        InfoFiSettlement settlement = new InfoFiSettlement(deployer, raffleAddress);
        infoFiSettlementAddress = address(settlement);
        console2.log("InfoFiSettlement deployed:");
        console2.log(infoFiSettlementAddress);

        // 6. Deploy InfoFiMarketFactory (glue between raffle & FPMM layer)
        console2.log("\nDeploying InfoFiMarketFactory...");
        InfoFiMarketFactory factory = new InfoFiMarketFactory(
            raffleAddress,
            priceOracleAddress,
            raffleOracleAdapterAddress,
            fpmmManagerAddress,
            sofTokenAddress,
            marketTypeRegistryAddress,
            deployer, // treasury (testnet)
            deployer // admin
        );
        infoFiMarketFactoryAddress = address(factory);
        console2.log("InfoFiMarketFactory deployed:");
        console2.log(infoFiMarketFactoryAddress);

        // 7. Grant PAYMASTER_ROLE to backend wallet
        // The backend wallet needs this role to call InfoFiMarketFactory.onPositionUpdate()
        // Read from BACKEND_WALLET_ADDRESS env var (derived from BACKEND_WALLET_PRIVATE_KEY)
        address backendWallet;
        try vm.envAddress("BACKEND_WALLET_ADDRESS") returns (address configured) {
            backendWallet = configured;
        } catch {
            // If not set, try to derive from private key
            try vm.envUint("BACKEND_WALLET_PRIVATE_KEY") returns (uint256 privateKey) {
                backendWallet = vm.addr(privateKey);
            } catch {
                backendWallet = address(0);
            }
        }

        if (backendWallet != address(0)) {
            console2.log("\nGranting PAYMASTER_ROLE to backend wallet:");
            console2.log(backendWallet);
            factory.setPaymasterAccount(backendWallet);
            console2.log("[OK] PAYMASTER_ROLE granted");
        } else {
            console2.log("\n[WARNING] BACKEND_WALLET_ADDRESS not set!");
            console2.log("You must manually grant PAYMASTER_ROLE by calling:");
            console2.log("  factory.setPaymasterAccount(backendWalletAddress)");
        }

        // 8. Grant FACTORY_ROLE to InfoFiMarketFactory on fpmmManager
        // The factory needs this role to call fpmmManager.createMarket()
        console2.log("\nGranting FACTORY_ROLE to InfoFiMarketFactory:");
        console2.log(infoFiMarketFactoryAddress);
        bytes32 FACTORY_ROLE = keccak256("FACTORY_ROLE");
        fpmmManager.grantRole(FACTORY_ROLE, infoFiMarketFactoryAddress);
        console2.log("[OK] FACTORY_ROLE granted");

        // 9. Grant RESOLVER_ROLE to InfoFiMarketFactory on RaffleOracleAdapter
        // The factory needs this role to call oracleAdapter.preparePlayerCondition()
        console2.log("\nGranting RESOLVER_ROLE to InfoFiMarketFactory:");
        console2.log(infoFiMarketFactoryAddress);
        bytes32 RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
        raffleOracleAdapter.grantRole(RESOLVER_ROLE, infoFiMarketFactoryAddress);
        console2.log("[OK] RESOLVER_ROLE granted");

        // 10. Approve InfoFiMarketFactory to spend SOF tokens from treasury
        // CRITICAL: The factory needs this approval to transfer liquidity when creating markets
        // Without this approval, market creation will fail with "Treasury allowance insufficient"
        console2.log("\nApproving InfoFiMarketFactory to spend SOF from treasury:");
        console2.log("Treasury:", deployer);
        console2.log("Spender:", infoFiMarketFactoryAddress);

        IERC20 sofToken = IERC20(sofTokenAddress);

        // Check current allowance
        uint256 currentAllowance = sofToken.allowance(deployer, infoFiMarketFactoryAddress);
        console2.log("Current allowance:", currentAllowance);

        // Approve max uint256 for unlimited spending
        bool approvalSuccess = sofToken.approve(infoFiMarketFactoryAddress, type(uint256).max);
        require(approvalSuccess, "SOF approval failed");

        // Verify new allowance
        uint256 newAllowance = sofToken.allowance(deployer, infoFiMarketFactoryAddress);
        console2.log("New allowance:", newAllowance);
        require(newAllowance == type(uint256).max, "Allowance not set correctly");

        console2.log("[OK] SOF approval granted (max uint256)");
        console2.log("[OK] Treasury setup complete - factory can now create markets");

        vm.stopBroadcast();

        // Summary
        console2.log("\n============================================================");
        console2.log("INFOFI SYSTEM DEPLOYMENT COMPLETE (BASE SEPOLIA)");
        console2.log("============================================================");
        console2.log("Deployer (admin/treasury testnet):", deployer);
        console2.log("SOF Token:", sofTokenAddress);
        console2.log("Raffle:", raffleAddress);
        console2.log("InfoFi Price Oracle:", priceOracleAddress);
        console2.log("RaffleOracleAdapter:", raffleOracleAdapterAddress);
        console2.log("ConditionalTokenSOF:", conditionalTokensAddress);
        console2.log("InfoFiFPMMV2 (FPMM manager):", fpmmManagerAddress);
        console2.log("MarketTypeRegistry:", marketTypeRegistryAddress);
        console2.log("InfoFiSettlement:", infoFiSettlementAddress);
        console2.log("RaffleOracleAdapter:", raffleOracleAdapterAddress);
        console2.log("InfoFiMarketFactory:", infoFiMarketFactoryAddress);
        console2.log("============================================================");
        console2.log(
            "NOTE: On mainnet, replace the deployer with a dedicated LP / treasury wallet for the treasury parameters."
        );
    }
}
