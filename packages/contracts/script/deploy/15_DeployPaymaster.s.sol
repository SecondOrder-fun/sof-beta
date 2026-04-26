// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFPaymaster} from "../../src/paymaster/SOFPaymaster.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";

contract DeployPaymaster is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        if (block.chainid != 31337) {
            console2.log("Skipping paymaster deploy (not local)");
            return addrs;
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // The local stack runs scripts/setup-local-aa.js before this script,
        // which deploys the real EntryPoint v0.8 at the canonical address. We
        // unconditionally point the paymaster there so the off-chain bundler,
        // viem, and the contract all share the same EntryPoint instance.
        // Forge's local simulation EVM does not see the anvil_setCode injection,
        // so a `code.length` check would always fall through to a stub even
        // when the real EntryPoint exists on chain — see the AA24 root cause
        // diagnosed during Test A bring-up.
        address entryPointAddr = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
        IEntryPoint entryPoint = IEntryPoint(entryPointAddr);

        vm.startBroadcast(deployerKey);

        SOFPaymaster paymaster = new SOFPaymaster(entryPoint, deployer, deployer);

        vm.stopBroadcast();

        addrs.paymasterAddress = address(paymaster);
        console2.log("SOFPaymaster:", address(paymaster));
        console2.log("EntryPoint deposit funded post-deploy via scripts/local-dev.sh");

        return addrs;
    }
}

