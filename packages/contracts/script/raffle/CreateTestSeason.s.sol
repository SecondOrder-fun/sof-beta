// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "src/core/Raffle.sol";
import "src/lib/RaffleTypes.sol";

/**
 * @notice Creates a short test season (20 min) for E2E testing.
 *         Start time = now + 30s so we can startSeason almost immediately.
 */
contract CreateTestSeason is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS");
        address caller = vm.addr(deployerPrivateKey);

        console2.log("=== CREATE TEST SEASON (20 min) ===");
        console2.log("Raffle:", raffleAddr);
        console2.log("Caller:", caller);

        Raffle raffle = Raffle(raffleAddr);

        // Verify role
        require(raffle.hasRole(raffle.SEASON_CREATOR_ROLE(), caller), "Missing SEASON_CREATOR_ROLE");

        vm.startBroadcast(deployerPrivateKey);

        uint256 startTs = block.timestamp + 300; // 5 minutes from now (buffer for tx confirmation)
        uint256 endTs = startTs + 20 minutes;

        console2.log("Start:", startTs);
        console2.log("End:", endTs);
        console2.log("Duration: 20 minutes");

        RaffleTypes.SeasonConfig memory config = RaffleTypes.SeasonConfig({
            name: "E2E Test Season",
            startTime: startTs,
            endTime: endTs,
            winnerCount: 1,
            grandPrizeBps: 6500,
            treasuryAddress: caller,
            raffleToken: address(0),
            bondingCurve: address(0),
            sponsor: address(0), // Will be set to msg.sender by contract
            isActive: false,
            isCompleted: false,
            gated: false
        });

        // Simple bonding curve: flat price for easy testing
        RaffleTypes.BondStep[] memory bondSteps = new RaffleTypes.BondStep[](3);
        bondSteps[0] = RaffleTypes.BondStep({rangeTo: 10_000, price: 0.01 ether});
        bondSteps[1] = RaffleTypes.BondStep({rangeTo: 50_000, price: 0.02 ether});
        bondSteps[2] = RaffleTypes.BondStep({rangeTo: 100_000, price: 0.05 ether});

        uint16 buyFeeBps = 10;  // 0.1%
        uint16 sellFeeBps = 70; // 0.7%

        uint256 seasonId = raffle.createSeason(config, bondSteps, buyFeeBps, sellFeeBps);
        console2.log("Season created! ID:", seasonId);

        // Get deployed contract addresses via getSeasonDetails
        (RaffleTypes.SeasonConfig memory details,,,,) = raffle.getSeasonDetails(seasonId);
        console2.log("Raffle token:", details.raffleToken);
        console2.log("Bonding curve:", details.bondingCurve);

        vm.stopBroadcast();
    }
}
