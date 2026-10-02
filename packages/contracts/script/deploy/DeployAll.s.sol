// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {HelperConfig} from "./HelperConfig.s.sol";

import {DeployVRFMock} from "./00_DeployVRFMock.s.sol";
import {DeployQuoteToken} from "./01_DeployQuoteToken.s.sol";
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
import {ConfigureRoles} from "./14_ConfigureRoles.s.sol";
import {DeployRolloverEscrow} from "./16_DeployRolloverEscrow.s.sol";
import {DeployUSDCMock} from "./17_DeployUSDCMock.s.sol";
import {AddVRFConsumer} from "./19_AddVRFConsumer.s.sol";
import {DeployPoolManager} from "./20_DeployPoolManager.s.sol";
import {DeployTokenLaunchpad} from "./21_DeployTokenLaunchpad.s.sol";
import {DeployLiquidityPlacer} from "./22_DeployLiquidityPlacer.s.sol";
import {DeployLaunchRouter} from "./23_DeployLaunchRouter.s.sol";
import {GrantBackendWallet} from "./24_GrantBackendWallet.s.sol";
import {Raffle} from "../../src/core/Raffle.sol";
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

        // The backend wallet must get PAYMASTER_ROLE on InfoFiMarketFactory (step 24),
        // or every position update it relays reverts. Fail here, before anything is
        // broadcast, rather than leave a deploy the backend can't use.
        if (!networkConfig.isLocal) {
            require(
                vm.envOr("BACKEND_WALLET_ADDRESS", address(0)) != address(0),
                "DeployAll: BACKEND_WALLET_ADDRESS is required (the backend wallet's address)"
            );
        }

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
        console2.log("=== 01: QuoteToken (placeholder) ===");
        addrs = new DeployQuoteToken().run(addrs);

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

        console2.log("=== 14: ConfigureRoles ===");
        addrs = new ConfigureRoles().run(addrs);

        console2.log("=== 24: GrantBackendWallet ===");
        addrs = new GrantBackendWallet().run(addrs);

        console2.log("=== 16: RolloverEscrow ===");
        addrs = new DeployRolloverEscrow().run(addrs);

        console2.log("=== 17: USDCMock (local only) ===");
        addrs = new DeployUSDCMock().run(addrs);

        console2.log("=== 16b: Wire RolloverEscrow roles ===");
        {
            RolloverEscrow rolloverEscrow = RolloverEscrow(addrs.rolloverEscrow);
            RafflePrizeDistributor distributor = RafflePrizeDistributor(addrs.prizeDistributor);
            SeasonFactory seasonFactory = SeasonFactory(addrs.seasonFactory);
            Raffle raffle = Raffle(addrs.raffle);
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

            // Raffle._executeFinalization calls openCohort on the escrow during
            // season finalization (see Raffle.sol). Grant the role + wire the
            // address so the call has authority and a target.
            try rolloverEscrow.grantRole(rolloverEscrow.DEFAULT_ADMIN_ROLE(), addrs.raffle) {
                console2.log("Granted DEFAULT_ADMIN_ROLE on RolloverEscrow to Raffle");
            } catch {
                console2.log("DEFAULT_ADMIN_ROLE on RolloverEscrow to Raffle already set");
            }

            try raffle.setRolloverEscrow(addrs.rolloverEscrow) {
                console2.log("Set RolloverEscrow on Raffle");
            } catch {
                console2.log("RolloverEscrow on Raffle already set");
            }

            vm.stopBroadcast();
        }

        // --- 16c: Treasury quote-token approval for RolloverEscrow ---
        // RolloverEscrow.spendFromRollover() pulls `bonusAmount` in the cohort's
        // own quote token via safeTransferFrom(treasury, ...), and a bonus is paid
        // only if that approval (and balance) is there. This approves the
        // platform default quote token only: seasons priced in a launch token need
        // the treasury to approve that token too, or their bonus is skipped
        // (BonusUnfunded). If the deployer == treasury (always true on local
        // Anvil), auto-grant max approval so rollover E2E works out of the box. On
        // testnet/mainnet the treasury is usually a different wallet, so log a
        // manual instruction instead.
        {
            address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
            address treasury = vm.envAddress("TREASURY_ADDRESS");
            if (treasury == deployer) {
                vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
                IERC20(addrs.quoteToken).approve(addrs.rolloverEscrow, type(uint256).max);
                vm.stopBroadcast();
                console2.log("Treasury auto-approved RolloverEscrow for the quote token (deployer == treasury)");
            } else {
                console2.log("IMPORTANT: Treasury must approve RolloverEscrow to spend the quote token");
                console2.log("  Run: <quoteToken>.approve(", vm.toString(addrs.rolloverEscrow), ", type(uint256).max)");
                console2.log("  From the treasury wallet, for", vm.toString(addrs.quoteToken));
                console2.log("  and again for each launch token whose seasons should pay a rollover bonus");
            }
        }

        // --- 18c: Register Raffle as VRF subscription consumer ---
        // Without this, requestSeasonEnd reverts InvalidConsumer(uint256,address)
        // (selector 0x79bfd401) at the coordinator. Idempotent + safe on local
        // (the VRF mock path keeps vrfCoordinator = address(0) until 00_DeployVRFMock
        // populates it; on Anvil consumer wiring is done in scripts/local-dev.sh
        // via cast and this step short-circuits).
        if (!networkConfig.isLocal) {
            console2.log("=== 19: AddVRFConsumer ===");
            addrs = new AddVRFConsumer().run(addrs);
        }

        // --- 20-22: Launchpad ---
        // Independent of the raffle stack above: a launched token is a quote token a season
        // may use, but nothing here depends on the launchpad existing. Deployed last so a
        // chain without a Uniswap v4 deployment still gets everything else.
        if (networkConfig.isLocal) {
            console2.log("=== 20: PoolManager (local v4 singleton) ===");
            addrs = new DeployPoolManager().run(addrs);
        }

        console2.log("=== 21: TokenLaunchpad ===");
        addrs = new DeployTokenLaunchpad().run(addrs);

        console2.log("=== 22: UniV4LiquidityPlacer (+ wire into launchpad) ===");
        addrs = new DeployLiquidityPlacer().run(addrs);

        console2.log("=== 23: UniV4LaunchRouter (+ set as launchpad.router) ===");
        addrs = new DeployLaunchRouter().run(addrs);

        // --- 4. Build the deployment JSON (reference only — nothing writes it;
        //         see the note in _buildDeploymentJson) ---
        _buildDeploymentJson(addrs, deploymentPath);
        console2.log("Skipping in-script JSON write.");
        console2.log("Run: node scripts/extract-deployment-addresses.js --network <network>");
        console2.log("=== DeployAll complete ===");
    }

    /**
     * @notice Builds the deployments/<network>.json payload from the in-memory addresses.
     * @dev Kept for reference only — nothing writes the result. See the note at the call
     *      site in run(): deployments/<network>.json is regenerated from the broadcast log
     *      by scripts/extract-deployment-addresses.js, which is authoritative under --resume.
     *      Lives in its own function so run() does not blow the Yul stack under via_ir.
     * @param addrs The accumulated deployed addresses
     * @param deploymentPath Path of the existing JSON file, read to preserve unmanaged keys
     * @return The JSON document
     */
    function _buildDeploymentJson(DeployedAddresses memory addrs, string memory deploymentPath)
        private
        returns (string memory)
    {
        string memory networkName;
        if (block.chainid == 31337) networkName = "local";
        else if (block.chainid == 84532) networkName = "base-sepolia";
        else if (block.chainid == 8453) networkName = "base-mainnet";
        else networkName = "unknown";

        // Read existing file to preserve non-managed keys.
        // Note: USDC mock moved into the managed set in 0.25.0
        // (deploy steps 17-18; SOFAirdrop step 19 was deleted in the gasless
        // rewrite). SOFBondingCurve / SeasonGating / VRFCoordinator are still
        // hand-maintained for non-local deploys.
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

        // Built one field at a time: a few big string.concat() calls keep too many
        // live memory pointers for via_ir's stack.
        string memory json = string.concat('{\n  "network": "', networkName, '",\n');
        json = string.concat(json, '  "chainId": ', vm.toString(block.chainid), ',\n');
        json = string.concat(json, '  "deployedAt": "', vm.toString(block.timestamp), '",\n');
        json = string.concat(json, '  "contracts": {\n');
        json = string.concat(json, '    "QuoteToken": "', vm.toString(addrs.quoteToken), '",\n');
        json = string.concat(json, '    "Raffle": "', vm.toString(addrs.raffle), '",\n');
        json = string.concat(json, '    "SeasonFactory": "', vm.toString(addrs.seasonFactory), '",\n');
        json = string.concat(json, '    "InfoFiPriceOracle": "', vm.toString(addrs.infoFiOracle), '",\n');
        json = string.concat(json, '    "ConditionalTokens": "', vm.toString(addrs.conditionalTokens), '",\n');
        json = string.concat(json, '    "RaffleOracleAdapter": "', vm.toString(addrs.oracleAdapter), '",\n');
        json = string.concat(json, '    "InfoFiFPMM": "', vm.toString(addrs.fpmmManager), '",\n');
        json = string.concat(json, '    "MarketTypeRegistry": "', vm.toString(addrs.marketTypeRegistry), '",\n');
        json = string.concat(json, '    "InfoFiFactory": "', vm.toString(addrs.infoFiFactory), '",\n');
        json = string.concat(json, '    "InfoFiSettlement": "', vm.toString(addrs.infoFiSettlement), '",\n');
        json = string.concat(json, '    "PrizeDistributor": "', vm.toString(addrs.prizeDistributor), '",\n');
        json = string.concat(json, '    "RolloverEscrow": "', vm.toString(addrs.rolloverEscrow), '",\n');
        // Newly managed addresses (0.25.0). USDC may be address(0) on
        // non-local until HelperConfig grows a per-network USDC field.
        json = string.concat(json, '    "USDC": "', vm.toString(addrs.usdc), '",\n');
        // Launchpad (0.35.0). PoolManager is the v4 singleton — locally deployed, elsewhere
        // supplied; LiquidityPlacer is address(0) on a chain where v4 is not deployed.
        json = string.concat(json, '    "PoolManager": "', vm.toString(addrs.poolManager), '",\n');
        json = string.concat(json, '    "TokenLaunchpad": "', vm.toString(addrs.tokenLaunchpad), '",\n');
        json = string.concat(json, '    "LiquidityPlacer": "', vm.toString(addrs.liquidityPlacer), '",\n');
        json = string.concat(json, '    "LaunchPoolGate": "', vm.toString(addrs.launchPoolGate), '",\n');
        json = string.concat(json, '    "LaunchRouter": "', vm.toString(addrs.launchRouter), '"');
        json = string.concat(json, preservedSection, "\n  }\n}");

        return json;
    }
}
