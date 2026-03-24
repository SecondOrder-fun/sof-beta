// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {SOFToken} from "src/token/SOFToken.sol";
import {SOFAirdrop} from "src/airdrop/SOFAirdrop.sol";

/**
 * @title RedeployAirdrop
 * @notice Redeploy SOFAirdrop with optional Farcaster (claimInitialBasic) support
 * @dev Usage:
 *   forge script script/deploy/07_RedeployAirdrop.s.sol \
 *     --rpc-url baseSepolia --broadcast --verify -vvvv
 *
 *   Required env vars:
 *     PRIVATE_KEY
 *     SOF_TOKEN_ADDRESS
 *     BACKEND_WALLET_ADDRESS
 */
contract RedeployAirdrop is Script {
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
        console2.log("Backend Wallet (attestor):", backendWallet);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new SOFAirdrop
        SOFAirdrop airdrop = new SOFAirdrop(
            sofTokenAddress,
            backendWallet,
            AIRDROP_INITIAL_AMOUNT,
            AIRDROP_BASIC_AMOUNT,
            AIRDROP_DAILY_AMOUNT,
            AIRDROP_COOLDOWN
        );
        console2.log("SOFAirdrop deployed:", address(airdrop));

        // 2. Grant MINTER_ROLE to new airdrop contract
        bytes32 minterRole = keccak256("MINTER_ROLE");
        sofToken.grantRole(minterRole, address(airdrop));
        console2.log("MINTER_ROLE granted to new SOFAirdrop");

        // 3. Grant RELAYER_ROLE to backend wallet for gasless claims
        bytes32 relayerRole = keccak256("RELAYER_ROLE");
        airdrop.grantRole(relayerRole, backendWallet);
        console2.log("RELAYER_ROLE granted to backend wallet:", backendWallet);

        vm.stopBroadcast();

        console2.log("\n============================================================");
        console2.log("AIRDROP REDEPLOYMENT COMPLETE (BASE SEPOLIA)");
        console2.log("============================================================");
        console2.log("SOF_AIRDROP_ADDRESS=", address(airdrop));
        console2.log("");
        console2.log("Update these env vars:");
        console2.log("  VITE_SOF_AIRDROP_ADDRESS_TESTNET=", address(airdrop));
        console2.log("  SOF_AIRDROP_ADDRESS_TESTNET=", address(airdrop));
        console2.log("============================================================");
    }
}
