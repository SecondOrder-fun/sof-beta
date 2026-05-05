// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFPaymaster} from "../../src/paymaster/SOFPaymaster.sol";

contract DeployPaymaster is Script {
    /// @dev Canonical EntryPoint v0.8 address — same on every chain via
    /// CREATE2. On LOCAL it's injected via anvil_setCode by
    /// scripts/setup-local-aa.js. On testnet/mainnet it's already deployed
    /// (Pimlico / OP / various bootstrappers landed it long ago).
    address internal constant ENTRY_POINT_V08 = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // On LOCAL the local stack runs scripts/setup-local-aa.js before this
        // script, which injects EntryPoint v0.8 via anvil_setCode. Forge's
        // local simulation EVM does not see that injection, so a code-length
        // check on LOCAL would always fall through to a stub even when the
        // real EntryPoint exists on chain — see the AA24 root cause diagnosed
        // during Test A bring-up. Skip the check on LOCAL only.
        //
        // On testnet/mainnet, require EntryPoint to actually be deployed at
        // the canonical address — deploying SOFPaymaster against a stub is a
        // footgun (every userOp would fail validation later).
        if (block.chainid != 31337) {
            uint256 epCodeLen = ENTRY_POINT_V08.code.length;
            if (epCodeLen == 0) {
                revert("EntryPoint v0.8 not deployed at canonical address on this chain");
            }
            console2.log("EntryPoint v0.8 verified at canonical (code length:", epCodeLen, ")");
        }

        vm.startBroadcast(deployerKey);
        // New constructor (gasless rewrite §3.3):
        //   (entryPoint, factory, raffle, initialAllowlist).
        // TODO(Task 2.2): wire the SOFSmartAccountFactory address (not yet in
        // DeployedAddresses) and a real allowlist from the deployments struct.
        // For now we pass the raffle from the struct, address(0) for factory
        // (placeholder until Task 2.1 adds the factory deploy step), and an
        // empty initial allowlist — Task 2.2 owns the proper wiring. The
        // deploy chain will produce a non-functional paymaster until then,
        // but builds + tests pass and Task 2.2 swaps in the real values.
        address[] memory initialAllowlist = new address[](0);
        SOFPaymaster paymaster = new SOFPaymaster(
            ENTRY_POINT_V08,
            address(0),
            addrs.raffle,
            initialAllowlist
        );
        // Silence unused-var warning until Task 2.2 reintroduces deployer
        // role assignment (Ownable was dropped in favour of AccessControl;
        // grants stay implicit since msg.sender is already DEFAULT_ADMIN).
        deployer;
        vm.stopBroadcast();

        addrs.paymasterAddress = address(paymaster);
        console2.log("SOFPaymaster:", address(paymaster));

        if (block.chainid == 31337) {
            console2.log("EntryPoint deposit funded post-deploy via scripts/local-dev.sh");
        } else {
            console2.log("");
            console2.log("=== POST-DEPLOY: fund the paymaster ===");
            console2.log("The paymaster needs an ETH deposit on the EntryPoint to sponsor ops.");
            console2.log("Run from a funded wallet (deployer is fine for testnet):");
            console2.log("  cast send", ENTRY_POINT_V08);
            console2.log("    \"depositTo(address)\"", address(paymaster));
            console2.log("    --value 0.05ether --rpc-url $RPC --private-key $PRIVATE_KEY");
            console2.log("Then verify:");
            console2.log("  cast call $PAYMASTER \"getDeposit()(uint256)\" --rpc-url $RPC");
        }

        return addrs;
    }
}

