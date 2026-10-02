// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title RevokeSmaRoles
/// @notice Takes back the admin roles the retired ConfigureRoles §9b mirrored
///         from the deployer onto its ERC-4337 smart account: Raffle
///         DEFAULT_ADMIN_ROLE, SEASON_CREATOR_ROLE, EMERGENCY_ROLE and
///         SeasonFactory DEFAULT_ADMIN_ROLE.
///
/// @dev Driven by scripts/revoke-sma-roles.sh, which reads the addresses from
///      the deployments file and verifies the result. Sending through forge
///      (--broadcast --slow) means forge assigns the nonces locally from one
///      read and waits for each receipt, instead of a per-send nonce lookup on
///      a load-balanced RPC. Idempotent: a role the target no longer holds is
///      skipped.
///
/// Env: RAFFLE_ADDRESS, SEASON_FACTORY_ADDRESS, REVOKE_TARGET, PRIVATE_KEY
///      (the deployer; must hold DEFAULT_ADMIN_ROLE on both contracts).
contract RevokeSmaRoles is Script {
    function run() external {
        address raffle = vm.envAddress("RAFFLE_ADDRESS");
        address seasonFactory = vm.envAddress("SEASON_FACTORY_ADDRESS");
        address target = vm.envAddress("REVOKE_TARGET");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        require(target != address(0), "RevokeSmaRoles: REVOKE_TARGET is the zero address");
        require(target != vm.addr(deployerKey), "RevokeSmaRoles: refusing to revoke the deployer's own roles");

        address[4] memory contracts_ = [raffle, raffle, raffle, seasonFactory];
        bytes32[4] memory roles = [
            keccak256("SEASON_CREATOR_ROLE"),
            keccak256("EMERGENCY_ROLE"),
            bytes32(0), // DEFAULT_ADMIN_ROLE
            bytes32(0) // DEFAULT_ADMIN_ROLE
        ];

        vm.startBroadcast(deployerKey);
        for (uint256 i = 0; i < 4; i++) {
            IAccessControl ac = IAccessControl(contracts_[i]);
            if (ac.hasRole(roles[i], target)) {
                ac.revokeRole(roles[i], target);
                console2.log("RevokeSmaRoles: revoked", vm.toString(roles[i]), "on", contracts_[i]);
            }
        }
        vm.stopBroadcast();
    }
}
