// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISeasonGating.sol";

/// @title SeasonGatingStorage
/// @notice Storage layout for SeasonGating upgradeable contract
/// @dev Follows storage gap pattern for upgradeability
abstract contract SeasonGatingStorage {
    // ============ Storage ============

    /// @notice Gate configurations per season
    /// @dev seasonId => array of GateConfig
    mapping(uint256 => ISeasonGating.GateConfig[]) internal _seasonGates;

    /// @notice User verification status per season per gate
    /// @dev seasonId => user => gateIndex => verified
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) internal _userVerified;

    /// @notice Address authorized to configure gates (Raffle contract or admin)
    address public raffleContract;

    /// @notice Reserved storage gap for future upgrades
    /// @dev 50 slots reserved for future storage variables
    uint256[47] private __gap;
}
