// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {SOFToken} from "src/token/SOFToken.sol";
import {Raffle} from "src/core/Raffle.sol";
import {RaffleTypes} from "src/lib/RaffleTypes.sol";
import {SOFBondingCurve} from "src/curve/SOFBondingCurve.sol";

contract BuyTickets is Script {
    uint256 constant TICKETS_TO_BUY = 2_000;

    function run() external {
        // Load contracts
        SOFToken sof = SOFToken(vm.envAddress("SOF_ADDRESS_LOCAL"));
        Raffle raffle = Raffle(vm.envAddress("RAFFLE_ADDRESS_LOCAL"));
        uint256 seasonId = vm.envOr("SEASON_ID", uint256(1));

        (RaffleTypes.SeasonConfig memory config,,,,) = raffle.getSeasonDetails(seasonId);
        SOFBondingCurve bondingCurve = SOFBondingCurve(config.bondingCurve);

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        uint256 balBefore = sof.balanceOf(deployer);
        console2.log("Deployer balance before:", balBefore);

        sof.approve(address(bondingCurve), type(uint256).max);

        uint256 maxCost = bondingCurve.calculateBuyPrice(TICKETS_TO_BUY) * 110 / 100; // 10% slippage
        bondingCurve.buyTokens(TICKETS_TO_BUY, maxCost);

        uint256 balAfter = sof.balanceOf(deployer);
        console2.log("Deployer balance after:", balAfter);
        console2.log("Deployer spent:", balBefore - balAfter);

        vm.stopBroadcast();
    }
}
