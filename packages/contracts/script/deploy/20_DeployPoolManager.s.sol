// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

/**
 * @notice Deploys a Uniswap v4 PoolManager. LOCAL ONLY.
 *
 * @dev The real v4 singleton already exists on every chain we would ship to, and Anvil is
 *      the one place it does not. Deploying it here is the same trick as 00_DeployVRFMock:
 *      it keeps the whole launch path — launch a token, place its supply, buy it — working
 *      end to end against a fresh local chain with no forking.
 *
 *      This is the genuine v4-core PoolManager, not a mock. A mock would make the local
 *      path prove nothing about the part of the system most likely to be wrong; v4's flash
 *      accounting is exactly what a local run needs to exercise.
 *
 *      On testnet/mainnet the address comes from HelperConfig.getPoolManager() instead.
 *
 *      Pinned to 0.8.26 because v4-core is.
 */
contract DeployPoolManager is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        require(block.chainid == 31337, "PoolManager: local only");

        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // The owner controls protocol fees only; it cannot touch pools or positions.
        PoolManager poolManager = new PoolManager(deployer);

        vm.stopBroadcast();

        addrs.poolManager = address(poolManager);

        console2.log("PoolManager (local v4 singleton):", address(poolManager));

        return addrs;
    }
}
