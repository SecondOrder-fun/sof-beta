// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "src/gating/SeasonGating.sol";
import "src/core/Raffle.sol";

/**
 * @title DeploySeasonGating
 * @notice Deploys the SeasonGating contract and wires it into the Raffle.
 *
 * Usage:
 *   PRIVATE_KEY=0x... RAFFLE_ADDRESS=0x... forge script \
 *     script/deploy/DeploySeasonGating.s.sol:DeploySeasonGating \
 *     --rpc-url $RPC_URL --broadcast
 *
 * After deployment, set VITE_SEASON_GATING_ADDRESS_TESTNET in Vercel
 * and SEASON_GATING_ADDRESS in Railway.
 */
contract DeploySeasonGating is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");

        console2.log("=== DEPLOY SEASON GATING ===");
        console2.log("Deployer:", deployer);
        console2.log("Raffle:", raffleAddr);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy SeasonGating with deployer as admin and raffle as authorized caller
        SeasonGating gating = new SeasonGating(deployer, raffleAddr);
        console2.log("SeasonGating deployed at:", address(gating));

        // Wire the gating contract into the Raffle
        Raffle raffle = Raffle(raffleAddr);
        raffle.setGatingContract(address(gating));
        console2.log("Raffle.gatingContract set to:", address(gating));

        // Verify
        address stored = raffle.gatingContract();
        require(stored == address(gating), "Gating contract mismatch after setGatingContract");
        console2.log("Verified: Raffle.gatingContract() ==", stored);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== NEXT STEPS ===");
        console2.log("1. Set VITE_SEASON_GATING_ADDRESS_TESTNET in Vercel env vars");
        console2.log("2. Set SEASON_GATING_ADDRESS in Railway env vars (if needed by backend)");
        console2.log("3. Trigger Vercel redeploy");
    }
}
