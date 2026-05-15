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

        // Spec §3.3 static allowlist:
        //   {Raffle, SOFToken, InfoFiFactory, InfoFiSettlement, InfoFiFPMM,
        //    RaffleOracleAdapter, RafflePrizeDistributor, RolloverEscrow,
        //    SOFExchange}
        //
        // Per-season SOFBondingCurve targets are NOT in the static set; they
        // are validated dynamically via IRaffleCurveRegistry(raffle).isSofCurve.
        //
        // RolloverEscrow (step 16) and SOFExchange (step 18) deploy AFTER this
        // script in the DeployAll chain, so their addresses are still zero in
        // `addrs` when we construct here. We initialize the allowlist with the
        // 7 already-deployed targets (including RafflePrizeDistributor, step 11)
        // and rely on DeployAll to call
        // `paymaster.setAllowlisted(rolloverEscrow|sofExchange, true)` after
        // those deploy. The deployer keeps DEFAULT_ADMIN_ROLE / ADMIN_ROLE
        // from the constructor, so the post-deploy wiring is authorized.
        address[] memory initialAllowlist = new address[](7);
        initialAllowlist[0] = addrs.raffle;
        initialAllowlist[1] = addrs.sofToken;
        initialAllowlist[2] = addrs.infoFiFactory;
        initialAllowlist[3] = addrs.infoFiSettlement;
        initialAllowlist[4] = addrs.fpmmManager; // InfoFiFPMMV2 instance
        initialAllowlist[5] = addrs.oracleAdapter;
        initialAllowlist[6] = addrs.prizeDistributor;

        vm.startBroadcast(deployerKey);
        // Constructor (gasless rewrite §3.3):
        //   (entryPoint, factory, raffle, initialAllowlist).
        // Reverts ZeroAddress if any of (entryPoint, factory, raffle) are zero.
        SOFPaymaster paymaster = new SOFPaymaster(
            ENTRY_POINT_V08,
            addrs.sofSmartAccountFactory,
            addrs.raffle,
            initialAllowlist
        );
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
