// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/infofi/InfoFiMarketFactory.sol";

/**
 * @title GrantBackendRole
 * @notice Grants BACKEND_ROLE to the backend wallet so it can call onPositionUpdate()
 * @dev Run this after deploying InfoFiMarketFactory if backend can't create markets
 *
 * Usage:
 *   forge script script/GrantBackendRole.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
 */
contract GrantBackendRole is Script {
    function run() external {
        // Load environment variables
        address factoryAddress = vm.envAddress("INFOFI_FACTORY_ADDRESS_LOCAL");
        address backendWallet = vm.envAddress("BACKEND_WALLET_ADDRESS");

        console.log("InfoFi Factory:", factoryAddress);
        console.log("Backend Wallet:", backendWallet);

        InfoFiMarketFactory factory = InfoFiMarketFactory(factoryAddress);

        // Check if backend already has the role
        bytes32 BACKEND_ROLE = keccak256("BACKEND_ROLE");
        bool hasRole = factory.hasRole(BACKEND_ROLE, backendWallet);

        console.log("Backend has BACKEND_ROLE:", hasRole);

        if (hasRole) {
            console.log("Backend wallet already has BACKEND_ROLE - no action needed");
            return;
        }

        // Grant the role
        vm.startBroadcast();

        console.log("Granting BACKEND_ROLE to backend wallet...");
        factory.grantRole(BACKEND_ROLE, backendWallet);

        vm.stopBroadcast();

        // Verify
        hasRole = factory.hasRole(BACKEND_ROLE, backendWallet);
        console.log("After grant - Backend has BACKEND_ROLE:", hasRole);

        if (hasRole) {
            console.log("SUCCESS: BACKEND_ROLE granted successfully!");
        } else {
            console.log("ERROR: Failed to grant BACKEND_ROLE");
            revert("Role grant failed");
        }
    }
}
