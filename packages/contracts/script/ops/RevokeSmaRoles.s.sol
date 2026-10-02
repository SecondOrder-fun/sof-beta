// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title RevokeSmaRoles
/// @notice Revokes the given (contract, role) pairs from REVOKE_TARGET — the
///         admin roles the retired ConfigureRoles §9b mirrored from the deployer
///         onto its ERC-4337 smart account.
///
/// @dev Driven by scripts/revoke-sma-roles.sh, which owns the role list, passes
///      only the pairs still held, and verifies the result. Sending through
///      forge (--broadcast --slow) means forge assigns the nonces locally from
///      one read and waits for each receipt, instead of a per-send nonce lookup
///      on a load-balanced RPC. Idempotent: a pair the target no longer holds is
///      skipped.
///
/// Env: REVOKE_CONTRACTS, REVOKE_ROLES (comma-separated, same length and order),
///      REVOKE_TARGET, PRIVATE_KEY (the deployer; must hold each role's admin role).
contract RevokeSmaRoles is Script {
    function run() external {
        address[] memory contracts_ = vm.envAddress("REVOKE_CONTRACTS", ",");
        bytes32[] memory roles = vm.envBytes32("REVOKE_ROLES", ",");
        address target = vm.envAddress("REVOKE_TARGET");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        require(contracts_.length == roles.length, "RevokeSmaRoles: REVOKE_CONTRACTS/REVOKE_ROLES length mismatch");
        require(target != address(0), "RevokeSmaRoles: REVOKE_TARGET is the zero address");
        require(target != vm.addr(deployerKey), "RevokeSmaRoles: refusing to revoke the deployer's own roles");

        vm.startBroadcast(deployerKey);
        for (uint256 i = 0; i < contracts_.length; i++) {
            IAccessControl ac = IAccessControl(contracts_[i]);
            if (ac.hasRole(roles[i], target)) {
                ac.revokeRole(roles[i], target);
                console2.log("RevokeSmaRoles: revoked", vm.toString(roles[i]), "on", contracts_[i]);
            }
        }
        vm.stopBroadcast();
    }
}
