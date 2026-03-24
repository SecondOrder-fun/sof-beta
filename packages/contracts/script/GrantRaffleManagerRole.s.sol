// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/core/Raffle.sol";
import "../src/curve/SOFBondingCurve.sol";

/**
 * @title GrantRaffleManagerRole
 * @notice Script to grant RAFFLE_MANAGER_ROLE to the deployer on an existing bonding curve
 * @dev This fixes the issue where the deployer can't extract fees or manage the curve
 */
contract GrantRaffleManagerRole is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address raffleAddr = vm.envAddress("RAFFLE_ADDRESS_LOCAL");
        address caller = vm.addr(deployerPrivateKey);

        // Get season ID from environment or default to 1
        uint256 seasonId = vm.envOr("SEASON_ID", uint256(1));

        console2.log("=== GRANT RAFFLE_MANAGER_ROLE ===");
        console2.log("Raffle address:", raffleAddr);
        console2.log("Caller address:", caller);
        console2.log("Season ID:", seasonId);

        Raffle raffle = Raffle(raffleAddr);

        vm.startBroadcast(deployerPrivateKey);

        // Get the bonding curve address for this season
        (,,,,,,, address bondingCurve,,,,) = raffle.seasons(seasonId);
        console2.log("Bonding curve address:", bondingCurve);

        if (bondingCurve == address(0)) {
            console2.log("ERROR: Bonding curve address is zero. Season may not exist.");
            vm.stopBroadcast();
            return;
        }

        // Cast to SOFBondingCurve to access the role
        SOFBondingCurve curve = SOFBondingCurve(bondingCurve);
        bytes32 raffleManagerRole = curve.RAFFLE_MANAGER_ROLE();

        console2.log("RAFFLE_MANAGER_ROLE hash:", vm.toString(raffleManagerRole));

        // Check if caller already has the role
        bool hasRole = curve.hasRole(raffleManagerRole, caller);
        console2.log("Caller already has RAFFLE_MANAGER_ROLE:", hasRole);

        if (hasRole) {
            console2.log("Role already granted. Nothing to do.");
            vm.stopBroadcast();
            return;
        }

        // Grant the role
        try curve.grantRole(raffleManagerRole, caller) {
            console2.log("Successfully granted RAFFLE_MANAGER_ROLE to caller");

            // Verify the grant
            bool nowHasRole = curve.hasRole(raffleManagerRole, caller);
            console2.log("Verification - Caller now has role:", nowHasRole);
        } catch Error(string memory reason) {
            console2.log("Failed to grant role. Reason:", reason);
        } catch {
            console2.log("Failed to grant role (unknown error)");
        }

        vm.stopBroadcast();
    }
}
