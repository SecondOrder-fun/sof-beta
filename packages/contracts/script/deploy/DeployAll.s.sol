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

        // --- 4. Write deployment JSON ---
        string memory networkName;
        if (block.chainid == 31337) networkName = "local";
        else if (block.chainid == 84532) networkName = "base-sepolia";
        else if (block.chainid == 8453) networkName = "base-mainnet";
        else networkName = "unknown";

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
            '    "Paymaster": "', vm.toString(addrs.paymasterAddress), '"\n',
            '  }\n}'
        );
        string memory json = string.concat(part1, part2, part3);

        vm.writeFile(deploymentPath, json);
        console2.log("Deployment JSON written to:", deploymentPath);
        console2.log("=== DeployAll complete ===");
    }
}
