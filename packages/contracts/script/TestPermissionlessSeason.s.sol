// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/lib/RaffleTypes.sol";

interface IRaffle {
    function createSeason(
        RaffleTypes.SeasonConfig memory config,
        RaffleTypes.BondStep[] memory bondSteps,
        uint16 buyFeeBps,
        uint16 sellFeeBps
    ) external returns (uint256 seasonId);
    
    function canCreateSeason(address account) external view returns (bool);
}

contract TestPermissionlessSeason is Script {
    address constant RAFFLE = 0x0D7e48ca6aCa7283b8A0A1D9D7C473bdE2d0be77;
    address constant TREASURY = 0x1eD4aC856D7a072C3a336C0971a47dB86A808Ff4; // Same as sender
    
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        
        console.log("Deployer:", deployer);
        console.log("Can create season:", IRaffle(RAFFLE).canCreateSeason(deployer));
        
        vm.startBroadcast(deployerKey);
        
        // Create season config
        RaffleTypes.SeasonConfig memory config = RaffleTypes.SeasonConfig({
            name: "Test Permissionless",
            startTime: block.timestamp + 300, // 5 min from now
            endTime: block.timestamp + 86400, // 1 day from now
            winnerCount: 3,
            grandPrizeBps: 6500,
            treasuryAddress: TREASURY,
            raffleToken: address(0), // Will be set by factory
            bondingCurve: address(0), // Will be set by factory
            sponsor: address(0), // Will be set by contract
            isActive: false,
            isCompleted: false,
            gated: false
        });
        
        // Simple 2-step bonding curve
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](2);
        steps[0] = RaffleTypes.BondStep({
            rangeTo: 1000 ether, // First 1000 tokens
            price: 1 ether      // 1 SOF per token
        });
        steps[1] = RaffleTypes.BondStep({
            rangeTo: 2000 ether, // Next 1000 tokens
            price: 2 ether      // 2 SOF per token
        });
        
        uint256 seasonId = IRaffle(RAFFLE).createSeason(config, steps, 100, 100); // 1% fees
        
        console.log("Season created! ID:", seasonId);
        
        vm.stopBroadcast();
    }
}
