// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {SOFToken} from "src/token/SOFToken.sol";
import {SOFExchange} from "src/exchange/SOFExchange.sol";
import {SOFAirdrop} from "src/airdrop/SOFAirdrop.sol";
import {MockUSDC} from "src/test-helpers/MockUSDC.sol";

/**
 * @title DeployExchangeAirdrop
 * @notice Deploy SOFExchange, SOFAirdrop, and MockUSDC to Base Sepolia
 * @dev Usage:
 *   forge script script/deploy/06_DeployExchangeAirdrop.s.sol \
 *     --rpc-url baseSepolia --broadcast --verify -vvvv
 *
 *   Required env vars:
 *     PRIVATE_KEY
 *     SOF_TOKEN_ADDRESS
 *     BACKEND_WALLET_ADDRESS
 */
contract DeployExchangeAirdrop is Script {
    /// @dev ETH rate: 10,000 SOF per 1 ETH
    uint256 constant ETH_RATE = 10_000e18;

    /// @dev USDC rate: 10 SOF per 1 USDC (6 decimals)
    /// sofOut = (amount * rate) / 1e18 => (1e6 * rate) / 1e18 = 10e18 => rate = 10e30
    uint256 constant USDC_RATE = 10e30;

    /// @dev Daily sell limit: 50,000 SOF
    uint256 constant DAILY_SELL_LIMIT = 50_000e18;

    /// @dev Airdrop initial claim (Farcaster-verified): 10,000 SOF
    uint256 constant AIRDROP_INITIAL_AMOUNT = 10_000e18;

    /// @dev Airdrop basic claim (no Farcaster): 5,000 SOF
    uint256 constant AIRDROP_BASIC_AMOUNT = 5_000e18;

    /// @dev Airdrop daily drip: 1,000 SOF
    uint256 constant AIRDROP_DAILY_AMOUNT = 1_000e18;

    /// @dev Airdrop cooldown: 24 hours
    uint256 constant AIRDROP_COOLDOWN = 86400;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address sofTokenAddress = vm.envAddress("SOF_TOKEN_ADDRESS");
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");

        SOFToken sofToken = SOFToken(sofTokenAddress);

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("SOFToken:", sofTokenAddress);
        console2.log("Backend Wallet:", backendWallet);

        vm.startBroadcast(deployerPrivateKey);

        // ================================================================
        // 1. Deploy MockUSDC
        // ================================================================
        MockUSDC mockUsdc = new MockUSDC();
        console2.log("MockUSDC deployed:", address(mockUsdc));

        // ================================================================
        // 2. Deploy SOFExchange
        // ================================================================
        SOFExchange exchange = new SOFExchange(sofTokenAddress, deployer);
        console2.log("SOFExchange deployed:", address(exchange));

        // ================================================================
        // 3. Deploy SOFAirdrop
        // ================================================================
        SOFAirdrop airdrop = new SOFAirdrop(
            sofTokenAddress,
            backendWallet,
            AIRDROP_INITIAL_AMOUNT,
            AIRDROP_BASIC_AMOUNT,
            AIRDROP_DAILY_AMOUNT,
            AIRDROP_COOLDOWN
        );
        console2.log("SOFAirdrop deployed:", address(airdrop));

        // ================================================================
        // 4. Grant MINTER_ROLE on SOFToken to Exchange and Airdrop
        // ================================================================
        bytes32 minterRole = keccak256("MINTER_ROLE");
        sofToken.grantRole(minterRole, address(exchange));
        console2.log("MINTER_ROLE granted to SOFExchange");

        sofToken.grantRole(minterRole, address(airdrop));
        console2.log("MINTER_ROLE granted to SOFAirdrop");

        // ================================================================
        // 5. Configure SOFExchange rates and limits
        // ================================================================

        // ETH rate: 10,000 SOF per 1 ETH
        exchange.setRate(address(0), ETH_RATE);
        console2.log("ETH rate set:", ETH_RATE);

        // USDC rate: 10 SOF per 1 USDC
        exchange.setRate(address(mockUsdc), USDC_RATE);
        console2.log("USDC rate set:", USDC_RATE);

        // Daily sell limit: 50,000 SOF
        exchange.setDailySellLimit(DAILY_SELL_LIMIT);
        console2.log("Daily sell limit set:", DAILY_SELL_LIMIT);

        vm.stopBroadcast();

        // ================================================================
        // SUMMARY
        // ================================================================
        console2.log("\n============================================================");
        console2.log("EXCHANGE & AIRDROP DEPLOYMENT COMPLETE (BASE SEPOLIA)");
        console2.log("============================================================");
        console2.log("Deployer:", deployer);
        console2.log("");
        console2.log("SOF_TOKEN_ADDRESS=", sofTokenAddress);
        console2.log("MOCK_USDC_ADDRESS=", address(mockUsdc));
        console2.log("SOF_EXCHANGE_ADDRESS=", address(exchange));
        console2.log("SOF_AIRDROP_ADDRESS=", address(airdrop));
        console2.log("");
        console2.log("VITE_SOF_EXCHANGE_ADDRESS_TESTNET=", address(exchange));
        console2.log("VITE_SOF_AIRDROP_ADDRESS_TESTNET=", address(airdrop));
        console2.log("VITE_MOCK_USDC_ADDRESS_TESTNET=", address(mockUsdc));
        console2.log("============================================================");
    }
}
