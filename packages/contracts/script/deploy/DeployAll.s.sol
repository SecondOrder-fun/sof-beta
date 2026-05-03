// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {HelperConfig} from "./HelperConfig.s.sol";

import {DeployVRFMock} from "./00_DeployVRFMock.s.sol";
import {DeploySOFToken} from "./01_DeploySOFToken.s.sol";
import {DeployRaffle} from "./02_DeployRaffle.s.sol";
import {DeploySeasonFactory} from "./03_DeploySeasonFactory.s.sol";
import {DeployInfoFiOracle} from "./04_DeployInfoFiOracle.s.sol";
import {DeployConditionalTokens} from "./05_DeployConditionalTokens.s.sol";
import {DeployOracleAdapter} from "./06_DeployOracleAdapter.s.sol";
import {DeployFPMM} from "./07_DeployFPMM.s.sol";
import {DeployMarketTypeRegistry} from "./08_DeployMarketTypeRegistry.s.sol";
import {DeployInfoFiFactory} from "./09_DeployInfoFiFactory.s.sol";
import {DeploySettlement} from "./10_DeploySettlement.s.sol";
import {DeployDistributor} from "./11_DeployDistributor.s.sol";
import {DeployFaucet} from "./12_DeployFaucet.s.sol";
import {DeploySOFSmartAccount} from "./13_DeploySOFSmartAccount.s.sol";
import {ConfigureRoles} from "./14_ConfigureRoles.s.sol";
import {DeployPaymaster} from "./15_DeployPaymaster.s.sol";
import {DeployRolloverEscrow} from "./16_DeployRolloverEscrow.s.sol";
import {DeployUSDCMock} from "./17_DeployUSDCMock.s.sol";
import {DeploySOFExchange} from "./18_DeploySOFExchange.s.sol";
import {DeploySOFAirdrop} from "./19_DeploySOFAirdrop.s.sol";
import {RafflePrizeDistributor} from "../../src/core/RafflePrizeDistributor.sol";
import {RolloverEscrow} from "../../src/core/RolloverEscrow.sol";
import {SeasonFactory} from "../../src/core/SeasonFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployAll is Script {
    function run() public {
        // --- 1. Load chain config ---
        HelperConfig helperConfig = new HelperConfig();
        HelperConfig.NetworkConfig memory networkConfig = helperConfig.getNetworkConfig();
        string memory deploymentPath = helperConfig.getDeploymentFilePath();

        DeployedAddresses memory addrs;

        // --- 2. VRF: mock on local, config on testnet/mainnet ---
        if (networkConfig.isLocal) {
            console2.log("=== Local deploy: deploying VRF mock ===");
            addrs = new DeployVRFMock().run(addrs);
        } else {
            console2.log("=== Non-local deploy: loading VRF config ===");
            addrs.vrfCoordinator = networkConfig.vrfCoordinator;
            addrs.vrfSubscriptionId = networkConfig.vrfSubscriptionId;
            addrs.vrfKeyHash = networkConfig.vrfKeyHash;
        }

        // --- 3. Deploy contracts in sequence ---
        console2.log("=== 01: SOFToken ===");
        addrs = new DeploySOFToken().run(addrs);

        console2.log("=== 02: Raffle ===");
        addrs = new DeployRaffle().run(addrs);

        console2.log("=== 03: SeasonFactory ===");
        addrs = new DeploySeasonFactory().run(addrs);

        console2.log("=== 04: InfoFiPriceOracle ===");
        addrs = new DeployInfoFiOracle().run(addrs);

        console2.log("=== 05: ConditionalTokenSOF ===");
        addrs = new DeployConditionalTokens().run(addrs);

        console2.log("=== 06: RaffleOracleAdapter ===");
        addrs = new DeployOracleAdapter().run(addrs);

        console2.log("=== 07: InfoFiFPMMV2 ===");
        addrs = new DeployFPMM().run(addrs);

        console2.log("=== 08: MarketTypeRegistry ===");
        addrs = new DeployMarketTypeRegistry().run(addrs);

        console2.log("=== 09: InfoFiMarketFactory ===");
        addrs = new DeployInfoFiFactory().run(addrs);

        console2.log("=== 10: InfoFiSettlement ===");
        addrs = new DeploySettlement().run(addrs);

        console2.log("=== 11: RafflePrizeDistributor ===");
        addrs = new DeployDistributor().run(addrs);

        console2.log("=== 12: SOFFaucet ===");
        addrs = new DeployFaucet().run(addrs);

        console2.log("=== 13: SOFSmartAccount ===");
        addrs = new DeploySOFSmartAccount().run(addrs);

        console2.log("=== 14: ConfigureRoles ===");
        addrs = new ConfigureRoles().run(addrs);

        console2.log("=== 15: SOFPaymaster ===");
        addrs = new DeployPaymaster().run(addrs);

        console2.log("=== 16: RolloverEscrow ===");
        addrs = new DeployRolloverEscrow().run(addrs);

        console2.log("=== 17: USDCMock (local only) ===");
        addrs = new DeployUSDCMock().run(addrs);

        console2.log("=== 18: SOFExchange ===");
        addrs = new DeploySOFExchange().run(addrs);

        console2.log("=== 19: SOFAirdrop ===");
        addrs = new DeploySOFAirdrop().run(addrs);

        console2.log("=== 16b: Wire RolloverEscrow roles ===");
        {
            RolloverEscrow rolloverEscrow = RolloverEscrow(addrs.rolloverEscrow);
            RafflePrizeDistributor distributor = RafflePrizeDistributor(addrs.prizeDistributor);
            SeasonFactory seasonFactory = SeasonFactory(addrs.seasonFactory);
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

            try rolloverEscrow.grantRole(rolloverEscrow.DISTRIBUTOR_ROLE(), addrs.prizeDistributor) {
                console2.log("Granted DISTRIBUTOR_ROLE on RolloverEscrow to PrizeDistributor");
            } catch {
                console2.log("DISTRIBUTOR_ROLE on RolloverEscrow already set");
            }

            try distributor.setRolloverEscrow(addrs.rolloverEscrow) {
                console2.log("Set RolloverEscrow on PrizeDistributor");
            } catch {
                console2.log("RolloverEscrow on PrizeDistributor already set");
            }

            try seasonFactory.setRolloverEscrow(addrs.rolloverEscrow) {
                console2.log("Set RolloverEscrow on SeasonFactory (auto-grants ESCROW_ROLE on new curves)");
            } catch {
                console2.log("RolloverEscrow on SeasonFactory already set");
            }

            vm.stopBroadcast();
        }

        // --- 16c: Treasury SOF approval for RolloverEscrow ---
        // RolloverEscrow.spendFromRollover() pulls `bonusAmount` via
        // safeTransferFrom(treasury, ...). If the deployer == treasury (always
        // true on local Anvil), auto-grant max approval so rollover E2E works
        // out of the box. On testnet/mainnet the treasury is usually a different
        // wallet, so log a manual instruction instead.
        {
            address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
            address treasury = vm.envAddress("TREASURY_ADDRESS");
            if (treasury == deployer) {
                vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
                IERC20(addrs.sofToken).approve(addrs.rolloverEscrow, type(uint256).max);
                vm.stopBroadcast();
                console2.log("Treasury auto-approved RolloverEscrow for SOF (deployer == treasury)");
            } else {
                console2.log("IMPORTANT: Treasury must approve RolloverEscrow for SOF spending");
                console2.log("  Run: sof.approve(", vm.toString(addrs.rolloverEscrow), ", type(uint256).max)");
                console2.log("  From the treasury wallet");
            }
        }

        // --- 4. Write deployment JSON (merge with existing file) ---
        string memory networkName;
        if (block.chainid == 31337) networkName = "local";
        else if (block.chainid == 84532) networkName = "base-sepolia";
        else if (block.chainid == 8453) networkName = "base-mainnet";
        else networkName = "unknown";

        // Read existing file to preserve non-managed keys.
        // Note: SOFExchange / SOFAirdrop / USDC moved into the managed set in
        // 0.25.0 (deploy steps 17-19). SOFBondingCurve / SeasonGating /
        // VRFCoordinator are still hand-maintained for non-local deploys.
        string[3] memory preserveKeys = ["SOFBondingCurve", "SeasonGating", "VRFCoordinator"];
        string[3] memory preserveVals;

        try vm.readFile(deploymentPath) returns (string memory existingJson) {
            for (uint256 i = 0; i < preserveKeys.length; i++) {
                string memory jsonPath = string.concat(".contracts.", preserveKeys[i]);
                try vm.parseJsonString(existingJson, jsonPath) returns (string memory val) {
                    preserveVals[i] = val;
                } catch {
                    preserveVals[i] = "";
                }
            }
        } catch {
            // File doesn't exist yet — no values to preserve
        }

        // Build preserved keys section (only include non-empty values)
        string memory preservedSection = "";
        for (uint256 i = 0; i < preserveKeys.length; i++) {
            if (bytes(preserveVals[i]).length > 0) {
                preservedSection = string.concat(
                    preservedSection,
                    ',\n    "', preserveKeys[i], '": "', preserveVals[i], '"'
                );
            }
        }

        // Split JSON construction to avoid Yul stack-too-deep
        string memory part1 = string.concat(
            '{\n  "network": "', networkName, '",\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "SOFToken": "', vm.toString(addrs.sofToken), '",\n',
            '    "Raffle": "', vm.toString(addrs.raffle), '",\n',
            '    "SeasonFactory": "', vm.toString(addrs.seasonFactory), '",\n'
        );
        string memory part2 = string.concat(
            '    "InfoFiPriceOracle": "', vm.toString(addrs.infoFiOracle), '",\n',
            '    "ConditionalTokens": "', vm.toString(addrs.conditionalTokens), '",\n',
            '    "RaffleOracleAdapter": "', vm.toString(addrs.oracleAdapter), '",\n',
            '    "InfoFiFPMM": "', vm.toString(addrs.fpmmManager), '",\n',
            '    "MarketTypeRegistry": "', vm.toString(addrs.marketTypeRegistry), '",\n',
            '    "InfoFiFactory": "', vm.toString(addrs.infoFiFactory), '",\n'
        );
        string memory part3 = string.concat(
            '    "InfoFiSettlement": "', vm.toString(addrs.infoFiSettlement), '",\n',
            '    "PrizeDistributor": "', vm.toString(addrs.prizeDistributor), '",\n',
            '    "SOFFaucet": "', vm.toString(addrs.faucet), '",\n',
            '    "SOFSmartAccount": "', vm.toString(addrs.sofSmartAccount), '",\n',
            '    "Paymaster": "', vm.toString(addrs.paymasterAddress), '",\n',
            '    "RolloverEscrow": "', vm.toString(addrs.rolloverEscrow), '",\n'
        );
        string memory part4 = string.concat(
            // Newly managed addresses (0.25.0). USDC may be address(0) on
            // non-local until HelperConfig grows a per-network USDC field.
            '    "SOFExchange": "', vm.toString(addrs.sofExchange), '",\n',
            '    "SOFAirdrop": "', vm.toString(addrs.sofAirdrop), '",\n',
            '    "USDC": "', vm.toString(addrs.usdc), '"',
            preservedSection,
            '\n  }\n}'
        );
        string memory json = string.concat(part1, part2, part3, part4);

        // NOTE: Disabled. Use scripts/extract-deployment-addresses.js instead —
        // run it after every `forge script ... --broadcast` (or --resume) to
        // regenerate deployments/<network>.json from the broadcast log.
        //
        // Why: this in-script writer reads addresses from the in-memory `addrs`
        // struct, which gets corrupted when --resume is used to recover from
        // a partial broadcast. The struct ends up mixing real addresses (for
        // newly-broadcast slots) with simulator-predicted addresses (for
        // already-broadcast slots), and on the 2026-05-02 redeploy the slots
        // ended up shifted such that "Raffle" pointed at InfoFiPriceOracle's
        // address. The broadcast log doesn't have this problem because each
        // entry is forge's authoritative record of the actual deployed address.
        //
        // Keeping the JSON-building code above for reference, but the file
        // write is gone — single source of truth via the JS extractor.
        // vm.writeFile(deploymentPath, json);
        json; // silence unused-local-warning
        console2.log("Skipping in-script JSON write.");
        console2.log("Run: node scripts/extract-deployment-addresses.js --network <network>");
        console2.log("=== DeployAll complete ===");
    }
}
