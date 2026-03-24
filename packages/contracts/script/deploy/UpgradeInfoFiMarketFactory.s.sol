// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {InfoFiMarketFactory} from "src/infofi/InfoFiMarketFactory.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title UpgradeInfoFiMarketFactory
 * @notice Deploys a new InfoFiMarketFactory with enhanced error messages
 * @dev This script deploys a new factory and sets up all necessary permissions and approvals
 *
 * Prerequisites:
 * - All other InfoFi contracts must already be deployed
 * - Set these environment variables:
 *   - RAFFLE_ADDRESS_TESTNET
 *   - SOF_ADDRESS_TESTNET
 *   - INFOFI_ORACLE_ADDRESS_TESTNET
 *   - RAFFLE_ORACLE_ADAPTER_ADDRESS_TESTNET
 *   - INFOFI_FPMM_ADDRESS_TESTNET
 *   - MARKET_TYPE_REGISTRY_ADDRESS_TESTNET (or will use default)
 *   - BACKEND_WALLET_ADDRESS
 *
 * Usage:
 * forge script script/deploy/UpgradeInfoFiMarketFactory.s.sol:UpgradeInfoFiMarketFactory \
 *   --rpc-url https://sepolia.base.org \
 *   --broadcast \
 *   --verify
 */
contract UpgradeInfoFiMarketFactory is Script {
    function run() public {
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying new InfoFiMarketFactory from:", deployer);
        console2.log("Chain ID:", block.chainid);

        // Read existing contract addresses from environment
        address raffleAddress = vm.envAddress("RAFFLE_ADDRESS_TESTNET");
        address sofTokenAddress = vm.envAddress("SOF_ADDRESS_TESTNET");
        address priceOracleAddress = vm.envAddress("INFOFI_ORACLE_ADDRESS_TESTNET");
        address raffleOracleAdapterAddress = vm.envAddress("RAFFLE_ORACLE_ADAPTER_ADDRESS_TESTNET");
        address fpmmManagerAddress = vm.envAddress("INFOFI_FPMM_ADDRESS_TESTNET");

        // Market type registry - REQUIRED, no fallback
        address marketTypeRegistryAddress = vm.envAddress("MARKET_TYPE_REGISTRY_ADDRESS_TESTNET");

        console2.log("\nExisting contract addresses:");
        console2.log("Raffle:", raffleAddress);
        console2.log("SOF Token:", sofTokenAddress);
        console2.log("Price Oracle:", priceOracleAddress);
        console2.log("Raffle Oracle Adapter:", raffleOracleAdapterAddress);
        console2.log("FPMM Manager:", fpmmManagerAddress);
        console2.log("Market Type Registry:", marketTypeRegistryAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new InfoFiMarketFactory
        console2.log("\nDeploying new InfoFiMarketFactory...");
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
        address factoryAddress = address(factory);
        console2.log("New InfoFiMarketFactory deployed:");
        console2.log(factoryAddress);

        // Grant PAYMASTER_ROLE to backend wallet
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");
        console2.log("\nGranting PAYMASTER_ROLE to backend wallet:");
        console2.log(backendWallet);
        factory.setPaymasterAccount(backendWallet);
        console2.log("[OK] PAYMASTER_ROLE granted");

        // Approve factory to spend SOF from treasury
        console2.log("\nApproving new factory to spend SOF from treasury:");
        console2.log("Treasury:", deployer);
        console2.log("Spender:", factoryAddress);

        IERC20 sofToken = IERC20(sofTokenAddress);

        // Check current allowance
        uint256 currentAllowance = sofToken.allowance(deployer, factoryAddress);
        console2.log("Current allowance:", currentAllowance);

        // Approve max uint256 for unlimited spending
        bool approvalSuccess = sofToken.approve(factoryAddress, type(uint256).max);
        require(approvalSuccess, "SOF approval failed");

        // Verify new allowance
        uint256 newAllowance = sofToken.allowance(deployer, factoryAddress);
        console2.log("New allowance:", newAllowance);
        require(newAllowance == type(uint256).max, "Allowance not set correctly");

        console2.log("[OK] SOF approval granted (max uint256)");
        console2.log("[OK] Treasury setup complete - factory can now create markets");

        vm.stopBroadcast();

        // Summary
        console2.log("\n============================================================");
        console2.log("INFOFI MARKET FACTORY UPGRADE COMPLETE");
        console2.log("============================================================");
        console2.log("New InfoFiMarketFactory:", factoryAddress);
        console2.log("Backend Wallet (Paymaster):", backendWallet);
        console2.log("============================================================");
        console2.log("\nNEXT STEPS:");
        console2.log("1. Update INFOFI_FACTORY_ADDRESS_TESTNET in .env:");
        console2.log("   INFOFI_FACTORY_ADDRESS_TESTNET=", factoryAddress);
        console2.log("2. Grant RESOLVER_ROLE on RaffleOracleAdapter:");
        console2.log("   cast send", raffleOracleAdapterAddress);
        console2.log("   'grantRole(bytes32,address)'");
        console2.log("   $(cast keccak 'RESOLVER_ROLE')");
        console2.log("   ", factoryAddress);
        console2.log("3. Grant FACTORY_ROLE on InfoFiFPMMV2:");
        console2.log("   cast send", fpmmManagerAddress);
        console2.log("   'grantRole(bytes32,address)'");
        console2.log("   $(cast keccak 'FACTORY_ROLE')");
        console2.log("   ", factoryAddress);
        console2.log("4. Restart backend to pick up new factory address");
        console2.log("5. Test with a new purchase");
        console2.log("============================================================");
    }
}
