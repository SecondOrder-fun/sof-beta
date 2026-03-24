// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RaffleTypes.sol";

interface ISeasonFactory {
    function createSeasonContracts(
        uint256 seasonId,
        RaffleTypes.SeasonConfig calldata config,
        RaffleTypes.BondStep[] calldata bondSteps,
        uint16 buyFeeBps,
        uint16 sellFeeBps
    ) external returns (address raffleTokenAddr, address curveAddr);
}
