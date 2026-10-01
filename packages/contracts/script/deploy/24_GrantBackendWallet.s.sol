// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {InfoFiMarketFactory} from "../../src/infofi/InfoFiMarketFactory.sol";

/// @title GrantBackendWallet
/// @notice Grants the backend wallet PAYMASTER_ROLE on InfoFiMarketFactory
///         (`setPaymasterAccount`). The backend's market-creation service sends
///         `onPositionUpdate` from that wallet, and the call is gated on the role:
///         without it every position update the backend relays reverts.
///
/// @dev The wallet is `BACKEND_WALLET_ADDRESS`, the same variable the backend
///      reads. DeployAll requires it on testnet/mainnet before broadcasting
///      anything; scripts/grant-backend-wallet.sh fills it from the backend env
///      file when it is not in the contracts env. Idempotent: does nothing when
///      the wallet already holds the role, so it is safe to re-run after a
///      backend key rotation.
///
/// Two entry points:
///   - run(DeployedAddresses memory) — chained from DeployAll.
///   - run() — standalone: reads the factory from `INFOFI_FACTORY_ADDRESS` or
///     `deployments/<network>.json`. Use it to grant the role on an existing
///     deploy (scripts/grant-backend-wallet.sh wraps this).
contract GrantBackendWallet is Script {
    function run() public returns (DeployedAddresses memory addrs) {
        try vm.envAddress("INFOFI_FACTORY_ADDRESS") returns (address explicitFactory) {
            addrs.infoFiFactory = explicitFactory;
            console2.log("GrantBackendWallet: using INFOFI_FACTORY_ADDRESS override:", explicitFactory);
        } catch {
            addrs.infoFiFactory = _readFactoryFromDeploymentJson(new HelperConfig().getDeploymentFilePath());
        }
        require(addrs.infoFiFactory != address(0), "GrantBackendWallet: InfoFiMarketFactory address unknown");
        require(
            vm.envOr("BACKEND_WALLET_ADDRESS", address(0)) != address(0),
            "GrantBackendWallet: BACKEND_WALLET_ADDRESS is not set"
        );
        return run(addrs);
    }

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address backendWallet = vm.envOr("BACKEND_WALLET_ADDRESS", address(0));
        if (backendWallet == address(0)) {
            // Only reachable on local: DeployAll requires the variable elsewhere.
            console2.log("GrantBackendWallet: BACKEND_WALLET_ADDRESS not set, skipping");
            return addrs;
        }

        InfoFiMarketFactory factory = InfoFiMarketFactory(addrs.infoFiFactory);
        if (factory.hasRole(factory.PAYMASTER_ROLE(), backendWallet)) {
            console2.log("GrantBackendWallet: backend wallet already holds PAYMASTER_ROLE", backendWallet);
            return addrs;
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        factory.setPaymasterAccount(backendWallet);
        vm.stopBroadcast();
        console2.log("GrantBackendWallet: granted PAYMASTER_ROLE on InfoFiMarketFactory to", backendWallet);

        return addrs;
    }

    function _readFactoryFromDeploymentJson(string memory path) internal view returns (address) {
        try vm.readFile(path) returns (string memory json) {
            try vm.parseJsonAddress(json, ".contracts.InfoFiFactory") returns (address fromJson) {
                console2.log("GrantBackendWallet: using InfoFiFactory from", path);
                return fromJson;
            } catch {
                console2.log("GrantBackendWallet: could not parse .contracts.InfoFiFactory from", path);
            }
        } catch {
            console2.log("GrantBackendWallet: deployment file not found:", path);
        }
        return address(0);
    }
}
