// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title SetupTreasuryApproval
 * @notice Sets up treasury approval for InfoFiMarketFactory to pull SOF tokens
 * @dev This script must be run by the treasury account
 *
 * CRITICAL: The treasury must approve the InfoFiMarketFactory to spend SOF tokens
 * before any markets can be created. Without this approval, market creation will fail
 * with "Treasury allowance insufficient" error.
 *
 * Usage:
 * forge script script/admin/SetupTreasuryApproval.s.sol:SetupTreasuryApproval \
 *   --rpc-url $RPC_URL \
 *   --private-key $TREASURY_PRIVATE_KEY \
 *   --broadcast
 */
contract SetupTreasuryApproval is Script {
    // Testnet addresses
    address constant SOF_TOKEN_TESTNET = 0x4200000000000000000000000000000000000006; // Wrapped ETH on Base Sepolia (placeholder)
    address constant INFOFI_FACTORY_TESTNET = 0x82FC961710e4dD2179b069E13E7a1354AF52a891;

    // Approval amount: 1 million SOF (enough for 10,000 markets at 100 SOF each)
    uint256 constant APPROVAL_AMOUNT = 1_000_000 ether;

    function run() external {
        // Get addresses from environment - REQUIRED, no fallbacks
        address sofToken = vm.envAddress("SOF_ADDRESS_TESTNET");
        address infoFiFactory = vm.envAddress("INFOFI_FACTORY_ADDRESS_TESTNET");
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");

        console.log("Setting up treasury approval...");
        console.log("SOF Token:", sofToken);
        console.log("InfoFi Factory:", infoFiFactory);
        console.log("Backend Wallet (Treasury):", backendWallet);
        console.log("Approval Amount:", APPROVAL_AMOUNT);

        vm.startBroadcast(privateKey);

        IERC20 sof = IERC20(sofToken);

        // Check current allowance
        uint256 currentAllowance = sof.allowance(msg.sender, infoFiFactory);
        console.log("Current Allowance:", currentAllowance);

        // Approve factory to spend SOF
        bool success = sof.approve(infoFiFactory, APPROVAL_AMOUNT);
        require(success, "Approval failed");

        // Verify new allowance
        uint256 newAllowance = sof.allowance(msg.sender, infoFiFactory);
        console.log("New Allowance:", newAllowance);

        require(newAllowance >= APPROVAL_AMOUNT, "Allowance not set correctly");

        vm.stopBroadcast();

        console.log("Treasury approval setup complete!");
    }
}
