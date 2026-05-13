// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRolloverEscrow {
    function deposit(address user, uint256 amount, uint256 seasonId) external;
    function openCohort(uint256 seasonId, uint16 bonusBps) external;
    function defaultBonusBps() external view returns (uint16);
}
