// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFFaucet} from "../../src/faucet/SOFFaucet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployFaucet is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        uint256[] memory allowedChainIds = new uint256[](2);
        allowedChainIds[0] = 31337;
        allowedChainIds[1] = 11155111;

        SOFFaucet faucet = new SOFFaucet(
            addrs.sofToken,
            50_000e18,
            6 hours,
            allowedChainIds
        );

        // Transfer 99M SOF to faucet (initialSupply - 1M keeper)
        IERC20(addrs.sofToken).transfer(address(faucet), 99_000_000 ether);

        vm.stopBroadcast();

        addrs.faucet = address(faucet);

        console2.log("SOFFaucet:", address(faucet));

        return addrs;
    }
}
