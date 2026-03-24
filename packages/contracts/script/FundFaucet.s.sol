// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/token/SOFToken.sol";

/**
 * @title FundFaucet
 * @dev Fund the new faucet with SOF tokens
 */
contract FundFaucet is Script {
    function run() external {
        address sofTokenAddress = vm.envAddress("SOF_ADDRESS_TESTNET");
        address faucetAddress = 0xA946df916A23819797d01Ba27b077Ef5Fbb1566e;
        uint256 fundAmount = 100_000 * 10 ** 18;  // 100,000 SOF
        
        console.log("FUNDING FAUCET");
        console.log("==============");
        console.log("SOF Token:", sofTokenAddress);
        console.log("Faucet:", faucetAddress);
        console.log("Amount:", fundAmount / 10 ** 18, "SOF");
        
        vm.startBroadcast();
        
        SOFToken sofToken = SOFToken(sofTokenAddress);
        
        // Transfer SOF to faucet
        bool success = sofToken.transfer(faucetAddress, fundAmount);
        require(success, "Transfer failed");
        
        console.log("SUCCESS: Faucet funded with 100,000 SOF");
        
        // Verify balance
        uint256 faucetBalance = sofToken.balanceOf(faucetAddress);
        console.log("Faucet balance:", faucetBalance / 10 ** 18, "SOF");
        
        vm.stopBroadcast();
    }
}
