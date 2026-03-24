// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {InfoFiPriceOracle} from "src/infofi/InfoFiPriceOracle.sol";

contract DeployOracleSepolia is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying InfoFiPriceOracle from:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        InfoFiPriceOracle oracle = new InfoFiPriceOracle(deployer, 7000, 3000);
        console2.log("InfoFiPriceOracle deployed:", address(oracle));

        vm.stopBroadcast();
    }
}
