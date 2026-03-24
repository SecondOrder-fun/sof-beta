// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/faucet/SOFFaucet.sol";

/**
 * @title DebugFaucetClaim
 * @dev Script to debug faucet claim failures by calling claim() and capturing debug events
 */
contract DebugFaucetClaim is Script {
    function run() external {
        // Get faucet address from environment
        address faucetAddress = vm.envAddress("SOF_FAUCET_ADDRESS_TESTNET");
        
        vm.startBroadcast();
        
        SOFFaucet faucet = SOFFaucet(faucetAddress);
        
        // Call claim() to trigger debug events
        try faucet.claim() {
            console.log("CLAIM SUCCEEDED");
        } catch Error(string memory reason) {
            console.log("CLAIM FAILED:", reason);
        } catch (bytes memory lowLevelData) {
            console.log("CLAIM FAILED - LOW LEVEL ERROR");
            console.logBytes(lowLevelData);
        }
        
        vm.stopBroadcast();
    }
}
