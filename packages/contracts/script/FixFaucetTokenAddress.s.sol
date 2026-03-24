// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/faucet/SOFFaucet.sol";

/**
 * @title FixFaucetTokenAddress
 * @dev Script to fix faucet by updating it to use the correct SOF token address
 */
contract FixFaucetTokenAddress is Script {
    function run() external {
        // Addresses
        address faucetAddress = 0xEE9367F0ffa73790af3FED8dceA095B338e70F1A;
        address correctSofToken = 0x452159a798d98981D5f964B0D93Aae7b79F45741;
        address wrongSofToken = 0x1a4a7c6817982b63fa6eE0629f4112532bc03d85;
        
        console.log("FAUCET FIX SCRIPT");
        console.log("================");
        console.log("Faucet address:", faucetAddress);
        console.log("Current (WRONG) token:", wrongSofToken);
        console.log("Correct token:", correctSofToken);
        
        vm.startBroadcast();
        
        SOFFaucet faucet = SOFFaucet(faucetAddress);
        
        // Update the token address
        faucet.setSofToken(correctSofToken);
        
        console.log("FIXED: Faucet now uses correct SOF token");
        
        vm.stopBroadcast();
    }
}
