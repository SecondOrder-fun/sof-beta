// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ITrackerACL
 * @notice Interface for granting MARKET_ROLE on position tracker
 */
interface ITrackerACL {
    function grantRole(bytes32 role, address account) external;
}
