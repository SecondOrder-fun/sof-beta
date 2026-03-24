// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

interface IRaffle {
    function sofToken() external view returns (IERC20);

    function recordParticipant(uint256 seasonId, address participant, uint256 ticketAmount) external;

    function removeParticipant(uint256 seasonId, address participant, uint256 ticketAmount) external;

    function setPositionTrackerForSeason(uint256 seasonId, address tracker) external;

    function getVrfRequestForSeason(uint256 seasonId) external view returns (uint256);
}
