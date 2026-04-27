// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFAirdrop} from "../../src/airdrop/SOFAirdrop.sol";
import {SOFToken} from "../../src/token/SOFToken.sol";

/// @notice Deploy SOFAirdrop + wire it for the relay-claim flow used by
///         the backend (`POST /api/airdrop/claim`):
///   - grant MINTER_ROLE on SOFToken (mint on every claim)
///   - grant RELAYER_ROLE to the deployer so `claimInitialFor` /
///     `claimInitialBasicFor` / `claimDailyFor` succeed when the backend
///     submits gasless claims on a user's behalf.
///
/// @dev Amounts and cooldown are tuned for testnet parity. On local Anvil
///      an admin can call `setCooldown(60)` post-deploy if they want to
///      drip every minute for testing.
contract DeploySOFAirdrop is Script {
    uint256 constant INITIAL_AMOUNT = 10_000e18;   // Farcaster-verified claim
    uint256 constant BASIC_AMOUNT = 1_000e18;      // Wallet-only claim
    uint256 constant DAILY_AMOUNT = 100e18;        // Daily drip
    uint256 constant COOLDOWN = 24 hours;

    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        require(addrs.sofToken != address(0), "DeploySOFAirdrop: SOFToken not deployed");

        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        SOFAirdrop airdrop = new SOFAirdrop(
            addrs.sofToken,
            deployer, // attestor: backend wallet signs Farcaster attestations
            INITIAL_AMOUNT,
            BASIC_AMOUNT,
            DAILY_AMOUNT,
            COOLDOWN
        );

        SOFToken(addrs.sofToken).grantRole(SOFToken(addrs.sofToken).MINTER_ROLE(), address(airdrop));
        airdrop.grantRole(airdrop.RELAYER_ROLE(), deployer);

        vm.stopBroadcast();

        addrs.sofAirdrop = address(airdrop);
        console2.log("SOFAirdrop:", address(airdrop));
        return addrs;
    }
}
