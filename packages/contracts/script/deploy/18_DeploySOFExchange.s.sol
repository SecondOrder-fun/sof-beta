// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFExchange} from "../../src/exchange/SOFExchange.sol";
import {SOFToken} from "../../src/token/SOFToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy SOFExchange + wire it for buy/sell:
///   - grant MINTER_ROLE on SOFToken so swap-in can mint
///   - set ETH and USDC rates (skip USDC if no mock/real address available)
///   - seed sell-side reserves (10 ETH + 1M USDC on local; non-local skips reserves)
///
/// @dev Rate semantics from SOFExchange: `sofOut = (amountIn * rate) / 1e18`,
///      where rate is "SOF wei per 1e18 of token wei" — the caller is responsible
///      for accounting for the input token's decimals. So:
///         ETH (18 dec): 1 ETH = 100k SOF  →  rate = 100_000e18
///         USDC (6 dec): 1 USDC = 1 SOF    →  rate = 1e30
contract DeploySOFExchange is Script {
    address constant ETH_SENTINEL = address(0);

    // Local seed values — picked so the "Get $SOF" UI returns sane quotes
    // out of the box. Adjust on testnet/mainnet via setRate / depositReserves
    // after the contract is live.
    uint256 constant ETH_RATE = 100_000e18;       // 1 ETH = 100k SOF
    uint256 constant USDC_RATE = 1e30;            // 1 USDC = 1 SOF (USDC has 6 decimals)
    uint256 constant ETH_RESERVES = 10 ether;
    uint256 constant USDC_RESERVES = 1_000_000 * 10 ** 6; // 1M USDC

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        require(addrs.sofToken != address(0), "DeploySOFExchange: SOFToken not deployed");

        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        SOFExchange exchange = new SOFExchange(addrs.sofToken, deployer);

        // Grant MINTER_ROLE so the exchange can mint SOF on swap-in.
        SOFToken(addrs.sofToken).grantRole(SOFToken(addrs.sofToken).MINTER_ROLE(), address(exchange));

        // Set rates and seed sell-side reserves.
        exchange.setRate(ETH_SENTINEL, ETH_RATE);

        if (addrs.usdc != address(0)) {
            exchange.setRate(addrs.usdc, USDC_RATE);

            // Approve + deposit USDC reserves so users can sell SOF → USDC.
            uint256 usdcBalance = IERC20(addrs.usdc).balanceOf(deployer);
            uint256 usdcToDeposit = usdcBalance < USDC_RESERVES ? usdcBalance : USDC_RESERVES;
            if (usdcToDeposit > 0) {
                IERC20(addrs.usdc).approve(address(exchange), usdcToDeposit);
                exchange.depositTokenReserves(addrs.usdc, usdcToDeposit);
            }
        }

        // Deposit ETH reserves only if the deployer has the spare. On local
        // Anvil the deployer starts with 10_000 ETH so this is a no-op concern.
        // On testnet/mainnet most faucet wallets won't clear 10 ETH — log
        // loudly so the operator knows SOF→ETH sells will revert until they
        // manually fund reserves.
        if (deployer.balance >= ETH_RESERVES) {
            exchange.depositReserves{value: ETH_RESERVES}();
        } else {
            console2.log("WARNING: deployer has < 10 ETH; SOFExchange has no sell-side ETH reserves");
            console2.log("  swapSOFForETH will revert with InsufficientReserves until funded");
            console2.log("  Run: exchange.depositReserves{value: X ether}() from an admin wallet");
        }

        vm.stopBroadcast();

        addrs.sofExchange = address(exchange);
        console2.log("SOFExchange:", address(exchange));
        return addrs;
    }
}
