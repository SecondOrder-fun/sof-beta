// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IHats
 * @notice Interface for Hats Protocol core contract
 * @dev Minimal interface for SecondOrder.fun integration
 * Full interface: https://github.com/Hats-Protocol/hats-protocol
 */
interface IHats {
    /**
     * @notice Check if an address is wearing a specific hat
     * @param account The address to check
     * @param hatId The hat ID to check
     * @return bool True if the account is wearing the hat
     */
    function isWearerOfHat(address account, uint256 hatId) external view returns (bool);

    /**
     * @notice Check if an address is in good standing for a hat
     * @param account The address to check
     * @param hatId The hat ID to check
     * @return bool True if the account is in good standing
     */
    function isInGoodStanding(address account, uint256 hatId) external view returns (bool);

    /**
     * @notice Get the balance of a specific hat for an account
     * @param account The address to check
     * @param hatId The hat ID to check
     * @return uint256 The balance (0 or 1 for most hats)
     */
    function balanceOf(address account, uint256 hatId) external view returns (uint256);

    /**
     * @notice Check if a hat is active
     * @param hatId The hat ID to check
     * @return bool True if the hat is active
     */
    function isActive(uint256 hatId) external view returns (bool);
}
