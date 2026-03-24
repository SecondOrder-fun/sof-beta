// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "src/core/Raffle.sol";
import "src/lib/RaffleTypes.sol";

contract CreateSeason is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS_LOCAL");
        address caller = vm.addr(deployerPrivateKey);

        console2.log("=== CREATE SEASON DEBUG ===");
        console2.log("Deployer private key exists:", deployerPrivateKey != 0);
        console2.log("Raffle address:", raffleAddr);
        console2.log("Caller address:", caller);

        Raffle raffle = Raffle(raffleAddr);

        // Check if caller has SEASON_CREATOR_ROLE
        bytes32 seasonCreatorRole = raffle.SEASON_CREATOR_ROLE();
        bool hasRole = raffle.hasRole(seasonCreatorRole, caller);
        console2.log("Caller has SEASON_CREATOR_ROLE:", hasRole);
        console2.log("SEASON_CREATOR_ROLE hash:", vm.toString(seasonCreatorRole));

        vm.startBroadcast(deployerPrivateKey);

        uint256 startTs = block.timestamp + 60 seconds;
        uint256 endTs = startTs + 14 days;

        console2.log("Start timestamp:", startTs);
        console2.log("End timestamp:", endTs);
        console2.log("Current block timestamp:", block.timestamp);

        RaffleTypes.SeasonConfig memory config = RaffleTypes.SeasonConfig({
            name: "Season 1",
            startTime: startTs,
            endTime: endTs,
            winnerCount: 3,
            grandPrizeBps: 6500, // 65% of total pool to grand winner (rest to consolation)
            treasuryAddress: caller, // Treasury receives accumulated fees
            raffleToken: address(0), // Will be set by the factory
            bondingCurve: address(0), // Will be set by the factory
            sponsor: address(0), // Will be set to msg.sender by contract
            isActive: false,
            isCompleted: false,
            gated: false // No gating by default
        });

        console2.log("Config validation:");
        console2.log("  name length:", bytes(config.name).length);
        console2.log("  startTime > now:", config.startTime > block.timestamp);
        console2.log("  endTime > startTime:", config.endTime > config.startTime);
        console2.log("  winnerCount > 0:", config.winnerCount > 0);
        console2.log("  grandPrizeBps <= 10000:", config.grandPrizeBps <= 10000);

        RaffleTypes.BondStep[] memory bondSteps = new RaffleTypes.BondStep[](10);
        bondSteps[0] = RaffleTypes.BondStep({rangeTo: 100_000, price: 0.1 ether});
        bondSteps[1] = RaffleTypes.BondStep({rangeTo: 200_000, price: 0.2 ether});
        bondSteps[2] = RaffleTypes.BondStep({rangeTo: 300_000, price: 0.3 ether});
        bondSteps[3] = RaffleTypes.BondStep({rangeTo: 400_000, price: 0.4 ether});
        bondSteps[4] = RaffleTypes.BondStep({rangeTo: 500_000, price: 0.5 ether});
        bondSteps[5] = RaffleTypes.BondStep({rangeTo: 600_000, price: 0.6 ether});
        bondSteps[6] = RaffleTypes.BondStep({rangeTo: 700_000, price: 0.7 ether});
        bondSteps[7] = RaffleTypes.BondStep({rangeTo: 800_000, price: 0.8 ether});
        bondSteps[8] = RaffleTypes.BondStep({rangeTo: 900_000, price: 0.9 ether});
        bondSteps[9] = RaffleTypes.BondStep({rangeTo: 1_000_000, price: 1.0 ether});

        console2.log("Bond steps length:", bondSteps.length);

        uint16 buyFeeBps = 10; // 0.1%
        uint16 sellFeeBps = 70; // 0.7%

        console2.log("About to call createSeason...");
        uint256 seasonId;
        try raffle.createSeason(config, bondSteps, buyFeeBps, sellFeeBps) returns (uint256 _seasonId) {
            seasonId = _seasonId;
            console2.log("Season created successfully with ID:", seasonId);
        } catch {
            console2.log("createSeason call failed");
            revert("Season creation failed");
        }

        // Get bonding curve address from season
        (,,,,,, address bondingCurveAddr,,,,,) = raffle.seasons(seasonId);
        console2.log("Bonding curve deployed at:", bondingCurveAddr);

        // Note: RAFFLE_MANAGER_ROLE is now automatically granted by SeasonFactory
        // during bonding curve creation (to both Raffle contract and deployer address)
        // Treasury address is stored directly on the bonding curve for fee extraction
        console2.log("RAFFLE_MANAGER_ROLE automatically granted by SeasonFactory to deployer");

        vm.stopBroadcast();
    }
}
