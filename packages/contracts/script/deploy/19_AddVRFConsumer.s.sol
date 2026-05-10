// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {IVRFSubscriptionV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFSubscriptionV2Plus.sol";

/// @title AddVRFConsumer
/// @notice Registers the freshly-deployed Raffle as a consumer on the configured
///         Chainlink VRF v2.5 subscription. Without this step `requestRandomWords`
///         reverts with `InvalidConsumer(uint256,address)` (selector 0x79bfd401)
///         and `Raffle.requestSeasonEnd` becomes uncallable.
///
/// @dev Skipped on local (Anvil VRF mock — `scripts/local-dev.sh` wires the
///      consumer via cast). On testnet/mainnet the call must be issued by the
///      subscription owner. We expect the deployer EOA / multisig to BE the
///      sub owner (both today on testnet and going forward on mainnet); on a
///      revert we log clear manual-action instructions instead of crashing
///      the deploy.
///
/// Two entry points:
///   - run(DeployedAddresses memory) — chained from DeployAll.
///   - run() — standalone: reads RAFFLE address from the env var
///     `RAFFLE_ADDRESS` (preferred) or falls back to
///     `deployments/<network>.json`. Use this to retrofit existing deploys
///     that were missing the consumer-add step.
contract AddVRFConsumer is Script {
    function run() public returns (DeployedAddresses memory) {
        DeployedAddresses memory addrs;

        HelperConfig helperConfig = new HelperConfig();
        HelperConfig.NetworkConfig memory networkConfig = helperConfig.getNetworkConfig();
        addrs.vrfCoordinator = networkConfig.vrfCoordinator;
        addrs.vrfSubscriptionId = networkConfig.vrfSubscriptionId;
        addrs.vrfKeyHash = networkConfig.vrfKeyHash;

        // Prefer explicit env override so this works against arbitrary historical
        // raffle addresses without depending on deployments/<network>.json being
        // up-to-date (it can drift if the post-deploy regeneration step is skipped).
        try vm.envAddress("RAFFLE_ADDRESS") returns (address explicitRaffle) {
            addrs.raffle = explicitRaffle;
            console2.log("AddVRFConsumer: using RAFFLE_ADDRESS env override:", explicitRaffle);
        } catch {
            addrs.raffle = _readRaffleFromDeploymentJson(helperConfig.getDeploymentFilePath());
        }

        return run(addrs);
    }

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        if (addrs.vrfCoordinator == address(0)) {
            console2.log("AddVRFConsumer: vrfCoordinator is zero (local/mock path?), skipping");
            return addrs;
        }
        if (addrs.raffle == address(0)) {
            console2.log("AddVRFConsumer: raffle address is zero, skipping");
            return addrs;
        }

        IVRFSubscriptionV2Plus coordinator = IVRFSubscriptionV2Plus(addrs.vrfCoordinator);
        uint256 subId = addrs.vrfSubscriptionId;

        // Idempotency: re-running on a deploy where the consumer is already
        // registered (e.g. forge --resume, or a partial redeploy that only
        // touched downstream contracts) must not waste a tx.
        (, , , address subOwner, address[] memory consumers) = coordinator.getSubscription(subId);
        for (uint256 i = 0; i < consumers.length; i++) {
            if (consumers[i] == addrs.raffle) {
                console2.log("AddVRFConsumer: Raffle already a consumer on sub", subId);
                console2.log("  Raffle:", addrs.raffle);
                return addrs;
            }
        }

        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        if (subOwner != deployer) {
            // Surfaced loudly so a multisig-owned subscription doesn't silently
            // produce the InvalidConsumer revert at first season-end.
            console2.log("AddVRFConsumer: deployer is NOT the subscription owner");
            console2.log("  Deployer:  ", deployer);
            console2.log("  Sub owner: ", subOwner);
            console2.log("  ACTION REQUIRED: have the sub owner run addConsumer(subId, raffle):");
            console2.log("    coordinator:", addrs.vrfCoordinator);
            console2.log("    subId:      ", subId);
            console2.log("    raffle:     ", addrs.raffle);
            return addrs;
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        try coordinator.addConsumer(subId, addrs.raffle) {
            console2.log("AddVRFConsumer: added Raffle as consumer");
            console2.log("  Raffle:", addrs.raffle);
            console2.log("  subId: ", subId);
        } catch (bytes memory err) {
            console2.log("AddVRFConsumer: addConsumer reverted -- run manually:");
            console2.log("  cast send", addrs.vrfCoordinator);
            console2.log("    'addConsumer(uint256,address)'");
            console2.log("    subId: ", subId);
            console2.log("    raffle:", addrs.raffle);
            console2.logBytes(err);
        }
        vm.stopBroadcast();

        return addrs;
    }

    function _readRaffleFromDeploymentJson(string memory path) internal returns (address) {
        try vm.readFile(path) returns (string memory existingJson) {
            try vm.parseJsonAddress(existingJson, ".contracts.Raffle") returns (address fromJson) {
                console2.log("AddVRFConsumer: using Raffle from", path);
                return fromJson;
            } catch {
                console2.log("AddVRFConsumer: could not parse .contracts.Raffle from", path);
            }
        } catch {
            console2.log("AddVRFConsumer: deployment file not found:", path);
        }
        return address(0);
    }
}
