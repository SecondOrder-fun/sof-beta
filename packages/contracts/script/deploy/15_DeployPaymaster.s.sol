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

        vm.startBroadcast(deployerKey);

        // On local Anvil, the EntryPoint v0.8 doesn't exist at the canonical address.
        // Deploy a minimal StubEntryPoint that handles deposits.
        address entryPointAddr = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
        IEntryPoint entryPoint;
        if (entryPointAddr.code.length == 0) {
            StubEntryPoint stub = new StubEntryPoint();
            entryPoint = IEntryPoint(address(stub));
            console2.log("Deployed StubEntryPoint at:", address(stub));
        } else {
            entryPoint = IEntryPoint(entryPointAddr);
        }
        SOFPaymaster paymaster = new SOFPaymaster(entryPoint, deployer, deployer);
        paymaster.deposit{value: 100 ether}();

        vm.stopBroadcast();

        addrs.paymasterAddress = address(paymaster);
        console2.log("SOFPaymaster:", address(paymaster));
        console2.log("Funded with 100 ETH deposit");

        return addrs;
    }
}

/// @dev Minimal stub EntryPoint for local Anvil. Handles deposits only.
///      NOT a real EntryPoint — just enough for the paymaster to deploy and fund.
contract StubEntryPoint {
    mapping(address => uint256) public deposits;

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        require(deposits[msg.sender] >= withdrawAmount, "insufficient deposit");
        deposits[msg.sender] -= withdrawAmount;
        withdrawAddress.transfer(withdrawAmount);
    }

    receive() external payable {}
}
