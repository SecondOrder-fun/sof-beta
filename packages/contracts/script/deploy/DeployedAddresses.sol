// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Shared struct accumulating deployed contract addresses.
///         Passed through the deploy chain so each script can read
///         dependencies and write its own address.
struct DeployedAddresses {
    address sofToken;
    address vrfCoordinator;
    uint256 vrfSubscriptionId;
    bytes32 vrfKeyHash;
    address raffle;
    address seasonFactory;
    address infoFiOracle;
    address conditionalTokens;
    address oracleAdapter;
    address fpmmManager;
    address marketTypeRegistry;
    address infoFiFactory;
    address infoFiSettlement;
    address prizeDistributor;
    address faucet;
    address sofSmartAccount;
    address paymasterAddress;
    address rolloverEscrow;
    address usdc;
    address sofExchange;
    address sofAirdrop;
}
