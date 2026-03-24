// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/curve/SOFBondingCurve.sol";

/**
 * @title GrantManagerRole
 * @dev Grant RAFFLE_MANAGER_ROLE to an address on the bonding curve
 */
contract GrantManagerRole is Script {
    function run() external {
        address bondingCurveAddress = vm.envAddress("BONDING_CURVE_ADDRESS_TESTNET");
        address managerAddress = vm.envAddress("MANAGER_ADDRESS");
        
        console.log("GRANTING RAFFLE_MANAGER_ROLE");
        console.log("============================");
        console.log("Bonding Curve:", bondingCurveAddress);
        console.log("Manager Address:", managerAddress);
        
        vm.startBroadcast();
        
        SOFBondingCurve curve = SOFBondingCurve(bondingCurveAddress);
        bytes32 managerRole = curve.RAFFLE_MANAGER_ROLE();
        
        console.log("RAFFLE_MANAGER_ROLE hash:");
        console.logBytes32(managerRole);
        
        // Grant the role
        curve.grantRole(managerRole, managerAddress);
        
        console.log("SUCCESS: RAFFLE_MANAGER_ROLE granted to", managerAddress);
        
        // Verify
        bool hasRole = curve.hasRole(managerRole, managerAddress);
        console.log("Verification - Has role:", hasRole);
        
        vm.stopBroadcast();
    }
}
