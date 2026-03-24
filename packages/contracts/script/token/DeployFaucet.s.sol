// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "src/faucet/SOFFaucet.sol";
import "src/token/SOFToken.sol";

/**
 * @title DeployFaucet
 * @dev Script to deploy the SOF Faucet contract and fund it with tokens
 */
contract DeployFaucet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address sofTokenAddress = vm.envAddress("SOF_ADDRESS");

        // Default values
        uint256 amountPerRequest = 10_000 * 10 ** 18; // 10,000 SOF tokens
        uint256 cooldownPeriod = 6 * 60 * 60; // 6 hours

        // Allowed chain IDs: Anvil (31337) and Sepolia (11155111)
        uint256[] memory allowedChainIds = new uint256[](2);
        allowedChainIds[0] = 31337;
        allowedChainIds[1] = 11155111;

        vm.startBroadcast(deployerPrivateKey);

        // Deploy faucet
        SOFFaucet faucet = new SOFFaucet(sofTokenAddress, amountPerRequest, cooldownPeriod, allowedChainIds);

        // Fund faucet with SOF tokens (most of the supply)
        SOFToken sofToken = SOFToken(sofTokenAddress);

        // Check deployer balance
        uint256 deployerBalance = sofToken.balanceOf(msg.sender);

        // Keep 1,000,000 SOF for the deployer and transfer the rest to the faucet
        uint256 deployerKeeps = 1_000_000 ether; // 1 million SOF
        uint256 faucetAmount = deployerBalance > deployerKeeps ? deployerBalance - deployerKeeps : 0;

        if (faucetAmount > 0) {
            sofToken.transfer(address(faucet), faucetAmount);
        }

        vm.stopBroadcast();

        console.log("SOF Faucet deployed at:", address(faucet));
        console.log("Deployer keeps", deployerKeeps / 1 ether, "SOF tokens");
        console.log("Faucet funded with", faucetAmount / 1 ether, "SOF tokens");

        // Output for environment variable update
        console.log("Add to .env file:");
        console.log("SOF_FAUCET_ADDRESS=", address(faucet));
    }
}
