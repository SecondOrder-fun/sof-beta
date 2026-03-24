// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {SOFToken} from "src/token/SOFToken.sol";
import {SOFAirdrop} from "src/airdrop/SOFAirdrop.sol";

/**
 * @title RedeployTokenAndAirdrop
 * @notice Deploy a new SOFToken (with mint support) and SOFAirdrop pair
 * @dev The old SOFToken was deployed without a mint() function, so the airdrop
 *      cannot mint tokens. This script deploys a fresh token + airdrop.
 *
 *   Usage:
 *     cd contracts
 *     forge script script/deploy/08_RedeployTokenAndAirdrop.s.sol \
 *       --rpc-url baseSepolia --broadcast --verify -vvvv
 *
 *   Required env vars:
 *     PRIVATE_KEY              — deployer / backend wallet private key
 *     BACKEND_WALLET_ADDRESS   — backend wallet (attestor + relayer)
 */
contract RedeployTokenAndAirdrop is Script {
    /// @dev Initial SOF supply minted to deployer (same as original: 100M)
    uint256 constant INITIAL_SUPPLY = 100_000_000e18;

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
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("Backend Wallet:", backendWallet);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new SOFToken with mint support
        SOFToken sofToken = new SOFToken("SecondOrder Fun", "SOF", INITIAL_SUPPLY);
        console2.log("SOFToken deployed:", address(sofToken));

        // 2. Deploy new SOFAirdrop pointing to new token
        SOFAirdrop airdrop = new SOFAirdrop(
            address(sofToken),
            backendWallet,
            AIRDROP_INITIAL_AMOUNT,
            AIRDROP_BASIC_AMOUNT,
            AIRDROP_DAILY_AMOUNT,
            AIRDROP_COOLDOWN
        );
        console2.log("SOFAirdrop deployed:", address(airdrop));

        // 3. Grant MINTER_ROLE on SOFToken to SOFAirdrop
        bytes32 minterRole = keccak256("MINTER_ROLE");
        sofToken.grantRole(minterRole, address(airdrop));
        console2.log("MINTER_ROLE granted to SOFAirdrop");

        // 4. Grant RELAYER_ROLE on SOFAirdrop to backend wallet
        bytes32 relayerRole = keccak256("RELAYER_ROLE");
        airdrop.grantRole(relayerRole, backendWallet);
        console2.log("RELAYER_ROLE granted to backend wallet:", backendWallet);

        vm.stopBroadcast();

        console2.log("\n============================================================");
        console2.log("TOKEN + AIRDROP DEPLOYMENT COMPLETE (BASE SEPOLIA)");
        console2.log("============================================================");
        console2.log("");
        console2.log("Update frontend (.env / Vercel):");
        console2.log("  VITE_SOF_ADDRESS_TESTNET=", address(sofToken));
        console2.log("  VITE_SOF_AIRDROP_ADDRESS_TESTNET=", address(airdrop));
        console2.log("");
        console2.log("Update backend (Railway):");
        console2.log("  SOF_AIRDROP_ADDRESS_TESTNET=", address(airdrop));
        console2.log("");
        console2.log("Update contracts/.env:");
        console2.log("  SOF_TOKEN_ADDRESS=", address(sofToken));
        console2.log("============================================================");
    }
}
