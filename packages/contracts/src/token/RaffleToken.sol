// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "openzeppelin-contracts/contracts/access/AccessControl.sol";

/**
 * @title Raffle Token
 * @notice ERC20 token representing raffle tickets for a specific season
 * @dev Allows secondary market trading, minted/burned only by bonding curve
 */
contract RaffleToken is ERC20, ERC20Burnable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    // Season metadata
    struct SeasonInfo {
        uint256 seasonId;
        string seasonName;
        uint256 startTime;
        uint256 endTime;
        bool isActive;
    }

    SeasonInfo public seasonInfo;

    // Events
    event SeasonStatusChanged(uint256 indexed seasonId, bool isActive);

    constructor(
        string memory name,
        string memory symbol,
        uint256 _seasonId,
        string memory _seasonName,
        uint256 _startTime,
        uint256 _endTime
    ) ERC20(name, symbol) ERC20Permit(name) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        seasonInfo = SeasonInfo({
            seasonId: _seasonId,
            seasonName: _seasonName,
            startTime: _startTime,
            endTime: _endTime,
            isActive: true
        });
    }

    /**
     * @notice Tickets are non-fractional
     * @dev Override ERC20 decimals to return 0
     */
    function decimals() public view virtual override returns (uint8) {
        return 0;
    }

    /**
     * @notice Mint tokens (only callable by bonding curve)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address (only callable by bonding curve)
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) public override onlyRole(BURNER_ROLE) {
        // Override burnFrom allowance behavior: bonding curve burns without allowance
        _burn(from, amount);
    }

    /**
     * @notice Update season active status
     * @param active New active status
     */
    function setSeasonActive(bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        seasonInfo.isActive = active;
        emit SeasonStatusChanged(seasonInfo.seasonId, active);
    }

    /**
     * @notice Get season information
     */
    function getSeasonInfo() external view returns (SeasonInfo memory) {
        return seasonInfo;
    }

    /**
     * @notice Check if season is currently active
     */
    function isSeasonActive() external view returns (bool) {
        return seasonInfo.isActive && block.timestamp >= seasonInfo.startTime && block.timestamp <= seasonInfo.endTime;
    }
}
