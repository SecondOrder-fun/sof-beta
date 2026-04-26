// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {Raffle} from "../../src/core/Raffle.sol";
import {SeasonFactory} from "../../src/core/SeasonFactory.sol";
import {RaffleOracleAdapter} from "../../src/infofi/RaffleOracleAdapter.sol";
import {InfoFiFPMMV2} from "../../src/infofi/InfoFiFPMMV2.sol";
import {InfoFiPriceOracle} from "../../src/infofi/InfoFiPriceOracle.sol";
import {RafflePrizeDistributor} from "../../src/core/RafflePrizeDistributor.sol";
import {RolloverEscrow} from "../../src/core/RolloverEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract ConfigureRoles is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        Raffle raffle = Raffle(addrs.raffle);
        SeasonFactory seasonFactory = SeasonFactory(addrs.seasonFactory);
        RaffleOracleAdapter oracleAdapter = RaffleOracleAdapter(addrs.oracleAdapter);
        InfoFiFPMMV2 fpmmManager = InfoFiFPMMV2(addrs.fpmmManager);
        InfoFiPriceOracle infoFiOracle = InfoFiPriceOracle(addrs.infoFiOracle);
        RafflePrizeDistributor distributor = RafflePrizeDistributor(addrs.prizeDistributor);
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // 1. seasonFactory.grantRole(RAFFLE_ADMIN_ROLE, raffle)
        try seasonFactory.grantRole(seasonFactory.RAFFLE_ADMIN_ROLE(), address(raffle)) {
            console2.log("Granted RAFFLE_ADMIN_ROLE on SeasonFactory to Raffle");
        } catch {
            console2.log("RAFFLE_ADMIN_ROLE on SeasonFactory already set");
        }

        // 2. raffle.grantRole(SEASON_CREATOR_ROLE, seasonFactory)
        try raffle.grantRole(raffle.SEASON_CREATOR_ROLE(), address(seasonFactory)) {
            console2.log("Granted SEASON_CREATOR_ROLE on Raffle to SeasonFactory");
        } catch {
            console2.log("SEASON_CREATOR_ROLE on Raffle for SeasonFactory already set");
        }

        // 3. raffle.grantRole(SEASON_CREATOR_ROLE, deployer)
        try raffle.grantRole(raffle.SEASON_CREATOR_ROLE(), deployer) {
            console2.log("Granted SEASON_CREATOR_ROLE on Raffle to deployer");
        } catch {
            console2.log("SEASON_CREATOR_ROLE on Raffle for deployer already set");
        }

        // 4. raffle.setSeasonFactory(seasonFactory)
        try raffle.setSeasonFactory(address(seasonFactory)) {
            console2.log("Set SeasonFactory on Raffle");
        } catch {
            console2.log("SeasonFactory on Raffle already set");
        }

        // 5. oracleAdapter.grantRole(RESOLVER_ROLE, infoFiFactory)
        try oracleAdapter.grantRole(oracleAdapter.RESOLVER_ROLE(), addrs.infoFiFactory) {
            console2.log("Granted RESOLVER_ROLE on OracleAdapter to InfoFiFactory");
        } catch {
            console2.log("RESOLVER_ROLE on OracleAdapter already set");
        }

        // 6. fpmmManager.grantRole(FACTORY_ROLE, infoFiFactory)
        try fpmmManager.grantRole(fpmmManager.FACTORY_ROLE(), addrs.infoFiFactory) {
            console2.log("Granted FACTORY_ROLE on FPMMManager to InfoFiFactory");
        } catch {
            console2.log("FACTORY_ROLE on FPMMManager already set");
        }

        // 7. infoFiOracle.grantRole(PRICE_UPDATER_ROLE, infoFiFactory)
        try infoFiOracle.grantRole(infoFiOracle.PRICE_UPDATER_ROLE(), addrs.infoFiFactory) {
            console2.log("Granted PRICE_UPDATER_ROLE on InfoFiOracle to InfoFiFactory");
        } catch {
            console2.log("PRICE_UPDATER_ROLE on InfoFiOracle already set");
        }

        // 8. distributor.grantRole(RAFFLE_ROLE, raffle)
        try distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle)) {
            console2.log("Granted RAFFLE_ROLE on PrizeDistributor to Raffle");
        } catch {
            console2.log("RAFFLE_ROLE on PrizeDistributor already set");
        }

        // 9. raffle.setPrizeDistributor(distributor)
        try raffle.setPrizeDistributor(address(distributor)) {
            console2.log("Set PrizeDistributor on Raffle");
        } catch {
            console2.log("PrizeDistributor on Raffle already set");
        }

        // Treasury must approve InfoFiFactory for SOF spending — needed when
        // a season's first market is created. On local/dev the deployer is
        // also the treasury, so we can broadcast the approval here. On
        // testnet/mainnet TREASURY_ADDRESS is a multisig and the env var
        // TREASURY_PRIVATE_KEY (if set) drives the approval; otherwise we
        // log the manual command and let ops handle it.
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        IERC20 sof = IERC20(addrs.sofToken);
        if (treasury == deployer) {
            try sof.approve(addrs.infoFiFactory, type(uint256).max) {
                console2.log("Approved InfoFiFactory for SOF spending (treasury == deployer)");
            } catch {
                console2.log("InfoFiFactory SOF approval already set or failed");
            }
        } else {
            console2.log("IMPORTANT: Treasury must approve InfoFiFactory for SOF spending");
            console2.log("  Run: sof.approve(", vm.toString(addrs.infoFiFactory), ", type(uint256).max)");
            console2.log("  From the treasury wallet:", vm.toString(treasury));
        }

        // 10. Wire RolloverEscrow
        if (addrs.rolloverEscrow != address(0)) {
            RolloverEscrow rolloverEscrow = RolloverEscrow(addrs.rolloverEscrow);

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

            console2.log("IMPORTANT: Treasury must approve RolloverEscrow for SOF spending");
            console2.log("  Run: sof.approve(", vm.toString(addrs.rolloverEscrow), ", type(uint256).max)");
            console2.log("  From the treasury wallet");
        }

        vm.stopBroadcast();

        console2.log("Role configuration complete");

        return addrs;
    }
}
