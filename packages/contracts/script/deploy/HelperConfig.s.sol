// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";

/// @title HelperConfig
/// @notice Chain-aware configuration for deploy scripts.
///         Returns VRF config, key hashes, and network-specific constants
///         based on block.chainid. Local (Anvil) deploys a VRF mock;
///         testnet/mainnet use real Chainlink addresses.
contract HelperConfig is Script {
    struct NetworkConfig {
        address vrfCoordinator;
        uint256 vrfSubscriptionId;
        bytes32 vrfKeyHash;
        bool isLocal;
    }

    // Base Sepolia Chainlink VRF v2.5
    address constant SEPOLIA_VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 constant SEPOLIA_KEY_HASH = 0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    // Base Mainnet Chainlink VRF v2.5 (update when available)
    address constant MAINNET_VRF_COORDINATOR = address(0); // TODO: set before mainnet deploy
    bytes32 constant MAINNET_KEY_HASH = bytes32(0);

    // Local
    bytes32 constant LOCAL_KEY_HASH = bytes32(uint256(1));

    function getNetworkConfig() public view returns (NetworkConfig memory) {
        if (block.chainid == 31337) {
            // Anvil — VRF mock will be deployed by 00_DeployVRFMock
            // Coordinator address is set after deployment via setLocalVRF()
            return NetworkConfig({
                vrfCoordinator: address(0), // populated by 00_DeployVRFMock
                vrfSubscriptionId: 0,
                vrfKeyHash: LOCAL_KEY_HASH,
                isLocal: true
            });
        } else if (block.chainid == 84532) {
            // Base Sepolia
            return NetworkConfig({
                vrfCoordinator: SEPOLIA_VRF_COORDINATOR,
                vrfSubscriptionId: vm.envUint("VRF_SUBSCRIPTION_ID"),
                vrfKeyHash: SEPOLIA_KEY_HASH,
                isLocal: false
            });
        } else if (block.chainid == 8453) {
            // Base Mainnet
            require(MAINNET_VRF_COORDINATOR != address(0), "HelperConfig: mainnet VRF coordinator not configured");
            return NetworkConfig({
                vrfCoordinator: MAINNET_VRF_COORDINATOR,
                vrfSubscriptionId: vm.envUint("VRF_SUBSCRIPTION_ID"),
                vrfKeyHash: MAINNET_KEY_HASH,
                isLocal: false
            });
        } else {
            revert("HelperConfig: unsupported chain");
        }
    }

    /// @notice The Uniswap v4 PoolManager the liquidity placer should target.
    ///
    /// @dev Deliberately NOT a hardcoded constant like the VRF coordinators above. The v4
    ///      singleton's address differs per chain, the launchpad is meant to move chains
    ///      (Base now, Robinhood Chain next — design.md §1.2), and a wrong address here
    ///      would not fail loudly: `initialize` would just revert deep inside a launch, or
    ///      worse, hit some unrelated contract. So it is supplied per deploy and resolved
    ///      in this order:
    ///
    ///        1. `POOL_MANAGER_ADDRESS` in the environment — how a new chain is brought up.
    ///        2. `.contracts.PoolManager` in deployments/<network>.json — the checked-in
    ///           record, so a repeat deploy needs no env var.
    ///
    ///      Local (Anvil) never reaches here: 20_DeployPoolManager deploys a real
    ///      PoolManager instead, the same way 00_DeployVRFMock handles VRF.
    ///
    /// @return poolManager The resolved address, or `address(0)` if neither source has one.
    ///         Callers decide whether that is fatal; it is not fatal for a deploy that
    ///         simply is not wiring the launchpad.
    function getPoolManager() public view returns (address poolManager) {
        try vm.envAddress("POOL_MANAGER_ADDRESS") returns (address fromEnv) {
            if (fromEnv != address(0)) return fromEnv;
        } catch {
            // Unset — fall through to the deployments file.
        }

        try vm.readFile(getDeploymentFilePath()) returns (string memory json) {
            try vm.parseJsonAddress(json, ".contracts.PoolManager") returns (address fromFile) {
                return fromFile;
            } catch {
                return address(0);
            }
        } catch {
            return address(0);
        }
    }

    function getDeploymentFilePath() public view returns (string memory) {
        if (block.chainid == 31337) return "deployments/local.json";
        if (block.chainid == 84532) return "deployments/testnet.json";
        if (block.chainid == 8453) return "deployments/mainnet.json";
        revert("HelperConfig: unsupported chain");
    }
}
