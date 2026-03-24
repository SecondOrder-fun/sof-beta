// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

// Phase 1: Core raffle
import {SOFToken} from "src/token/SOFToken.sol";
import {Raffle} from "src/core/Raffle.sol";
import {SeasonFactory} from "src/core/SeasonFactory.sol";
import {SOFBondingCurve} from "src/curve/SOFBondingCurve.sol";
import {SOFFaucet} from "src/faucet/SOFFaucet.sol";
import {RafflePrizeDistributor} from "src/core/RafflePrizeDistributor.sol";

// Phase 2: InfoFi
import {ConditionalTokenSOF} from "src/infofi/ConditionalTokenSOF.sol";
import {RaffleOracleAdapter} from "src/infofi/RaffleOracleAdapter.sol";
import {InfoFiFPMMV2} from "src/infofi/InfoFiFPMMV2.sol";
import {MarketTypeRegistry} from "src/infofi/MarketTypeRegistry.sol";
import {InfoFiSettlement} from "src/infofi/InfoFiSettlement.sol";
import {InfoFiMarketFactory} from "src/infofi/InfoFiMarketFactory.sol";

// Chainlink VRF
import {IVRFCoordinatorV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title RedeployAllSepolia
 * @notice Full redeployment of all contracts to Base Sepolia with correct VRF Coordinator
 * @dev Usage:
 *   forge script script/deploy/05_RedeployAllSepolia.s.sol \
 *     --rpc-url baseSepolia --broadcast --verify -vvvv
 *
 *   Required env vars:
 *     PRIVATE_KEY
 *     VRF_COORDINATOR_ADDRESS_TESTNET (0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE)
 *     VRF_SUBSCRIPTION_ID_TESTNET
 *     VRF_KEY_HASH_TESTNET
 *     INFOFI_ORACLE_ADDRESS_TESTNET
 */
contract RedeployAllSepolia is Script {
    uint256 constant INITIAL_SOF_SUPPLY = 100_000_000e18; // 100M SOF
    uint256 constant FAUCET_FUND_AMOUNT = 100_000e18; // 100K SOF for faucet

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address vrfCoordinator = vm.envAddress("VRF_COORDINATOR_ADDRESS_TESTNET");
        uint256 vrfSubscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID_TESTNET");
        bytes32 vrfKeyHash = vm.envBytes32("VRF_KEY_HASH_TESTNET");
        address priceOracle = vm.envAddress("INFOFI_ORACLE_ADDRESS_TESTNET");

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("VRF Coordinator:", vrfCoordinator);

        vm.startBroadcast(deployerPrivateKey);

        // ================================================================
        // PHASE 1: Core Raffle System
        // ================================================================

        // 1. SOF Token
        console2.log("\n--- Phase 1: Core Raffle ---");
        SOFToken sofToken = new SOFToken("SecondOrder Fun", "SOF", INITIAL_SOF_SUPPLY);
        console2.log("SOFToken:", address(sofToken));

        // 2. Raffle (with correct VRF Coordinator)
        Raffle raffle = new Raffle(address(sofToken), vrfCoordinator, vrfSubscriptionId, vrfKeyHash);
        console2.log("Raffle:", address(raffle));

        // 3. Add Raffle as VRF consumer
        IVRFCoordinatorV2Plus(vrfCoordinator).addConsumer(vrfSubscriptionId, address(raffle));
        console2.log("Raffle added as VRF consumer");

        // 4. SeasonFactory
        SeasonFactory seasonFactory = new SeasonFactory(address(raffle));
        console2.log("SeasonFactory:", address(seasonFactory));

        // 5. Wire SeasonFactory into Raffle
        raffle.setSeasonFactory(address(seasonFactory));

        // 6. SOFBondingCurve (standalone, used as template by SeasonFactory)
        SOFBondingCurve bondingCurve = new SOFBondingCurve(address(sofToken), deployer);
        console2.log("SOFBondingCurve:", address(bondingCurve));

        // 7. Grant BONDING_CURVE_ROLE
        raffle.grantRole(keccak256("BONDING_CURVE_ROLE"), address(bondingCurve));

        // 8. SOFFaucet
        uint256[] memory allowedChainIds = new uint256[](2);
        allowedChainIds[0] = 31337; // Anvil
        allowedChainIds[1] = 84532; // Base Sepolia
        SOFFaucet sofFaucet = new SOFFaucet(address(sofToken), 1000e18, 1 days, allowedChainIds);
        console2.log("SOFFaucet:", address(sofFaucet));

        // 9. RafflePrizeDistributor
        RafflePrizeDistributor prizeDistributor = new RafflePrizeDistributor(deployer);
        console2.log("RafflePrizeDistributor:", address(prizeDistributor));

        // 10. Wire roles
        prizeDistributor.grantRole(keccak256("RAFFLE_ROLE"), address(raffle));
        raffle.setPrizeDistributor(address(prizeDistributor));
        raffle.grantRole(keccak256("SEASON_CREATOR_ROLE"), deployer);
        raffle.grantRole(keccak256("EMERGENCY_ROLE"), deployer);

        // 11. Fund faucet
        sofToken.transfer(address(sofFaucet), FAUCET_FUND_AMOUNT);
        console2.log("Faucet funded with", FAUCET_FUND_AMOUNT / 1e18, "SOF");

        // ================================================================
        // PHASE 2: InfoFi System
        // ================================================================
        console2.log("\n--- Phase 2: InfoFi ---");

        // 12. ConditionalTokenSOF
        ConditionalTokenSOF conditionalTokens = new ConditionalTokenSOF();
        console2.log("ConditionalTokenSOF:", address(conditionalTokens));

        // 13. RaffleOracleAdapter
        RaffleOracleAdapter raffleOracleAdapter = new RaffleOracleAdapter(address(conditionalTokens), deployer);
        console2.log("RaffleOracleAdapter:", address(raffleOracleAdapter));

        // 14. InfoFiFPMMV2
        InfoFiFPMMV2 fpmmManager = new InfoFiFPMMV2(
            address(conditionalTokens),
            address(sofToken),
            deployer, // treasury (testnet)
            deployer  // admin
        );
        console2.log("InfoFiFPMMV2:", address(fpmmManager));

        // 15. MarketTypeRegistry
        MarketTypeRegistry marketRegistry = new MarketTypeRegistry(deployer);
        console2.log("MarketTypeRegistry:", address(marketRegistry));

        // 16. InfoFiSettlement
        InfoFiSettlement settlement = new InfoFiSettlement(deployer, address(raffle));
        console2.log("InfoFiSettlement:", address(settlement));

        // 17. InfoFiMarketFactory
        InfoFiMarketFactory factory = new InfoFiMarketFactory(
            address(raffle),
            priceOracle,
            address(raffleOracleAdapter),
            address(fpmmManager),
            address(sofToken),
            address(marketRegistry),
            deployer, // treasury (testnet)
            deployer  // admin
        );
        console2.log("InfoFiMarketFactory:", address(factory));

        // 18. Wire InfoFi roles

        // FACTORY_ROLE on fpmmManager
        fpmmManager.grantRole(keccak256("FACTORY_ROLE"), address(factory));

        // RESOLVER_ROLE on RaffleOracleAdapter
        raffleOracleAdapter.grantRole(keccak256("RESOLVER_ROLE"), address(factory));

        // PAYMASTER_ROLE on InfoFiMarketFactory (backend wallet)
        address backendWallet;
        try vm.envAddress("BACKEND_WALLET_ADDRESS") returns (address configured) {
            backendWallet = configured;
        } catch {
            try vm.envUint("BACKEND_WALLET_PRIVATE_KEY") returns (uint256 pk) {
                backendWallet = vm.addr(pk);
            } catch {
                backendWallet = address(0);
            }
        }

        if (backendWallet != address(0)) {
            factory.setPaymasterAccount(backendWallet);
            console2.log("PAYMASTER_ROLE granted to:", backendWallet);
        } else {
            console2.log("WARNING: BACKEND_WALLET_ADDRESS not set - grant PAYMASTER_ROLE manually");
        }

        // 19. Approve factory to spend SOF from treasury (deployer)
        sofToken.approve(address(factory), type(uint256).max);
        console2.log("SOF approval granted to factory");

        vm.stopBroadcast();

        // ================================================================
        // SUMMARY
        // ================================================================
        console2.log("\n============================================================");
        console2.log("FULL REDEPLOYMENT COMPLETE (BASE SEPOLIA)");
        console2.log("============================================================");
        console2.log("Deployer:", deployer);
        console2.log("");
        console2.log("--- Core Raffle ---");
        console2.log("VITE_SOF_ADDRESS_TESTNET=", address(sofToken));
        console2.log("VITE_RAFFLE_ADDRESS_TESTNET=", address(raffle));
        console2.log("VITE_SEASON_FACTORY_ADDRESS_TESTNET=", address(seasonFactory));
        console2.log("VITE_SOF_BONDING_CURVE_ADDRESS_TESTNET=", address(bondingCurve));
        console2.log("VITE_SOF_FAUCET_ADDRESS_TESTNET=", address(sofFaucet));
        console2.log("VITE_PRIZE_DISTRIBUTOR_ADDRESS_TESTNET=", address(prizeDistributor));
        console2.log("");
        console2.log("--- InfoFi ---");
        console2.log("VITE_CONDITIONAL_TOKENS_ADDRESS_TESTNET=", address(conditionalTokens));
        console2.log("VITE_INFOFI_FACTORY_ADDRESS_TESTNET=", address(factory));
        console2.log("VITE_INFOFI_SETTLEMENT_ADDRESS_TESTNET=", address(settlement));
        console2.log("VITE_INFOFI_ORACLE_ADDRESS_TESTNET=", priceOracle);
        console2.log("");
        console2.log("--- Internal (not in .env) ---");
        console2.log("RaffleOracleAdapter:", address(raffleOracleAdapter));
        console2.log("InfoFiFPMMV2:", address(fpmmManager));
        console2.log("MarketTypeRegistry:", address(marketRegistry));
        console2.log("============================================================");
    }
}
