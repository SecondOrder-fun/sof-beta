// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title MockERC20
 * @notice 18-decimal ERC-20 with ERC-2612 permit and unrestricted minting.
 * @dev Stands in for a quote token in tests and local deployments. Every launched token
 *      is 18 decimals with permit (see docs/05-features/launchpad/design.md §5.2), so this
 *      mirrors the shape a real quote token will have — including the permit path the ticket
 *      curve tries before falling back to approve.
 *
 *      Constructor signature intentionally matches the SOFToken it replaced, so tests that
 *      used SOFToken as a generic quote token are a one-word change.
 *
 *      Test/local only. Not deployed to testnet or mainnet.
 */
contract MockERC20 is ERC20, ERC20Permit {
    constructor(string memory name_, string memory symbol_, uint256 initialSupply)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (initialSupply > 0) {
            _mint(msg.sender, initialSupply);
        }
    }

    /// @notice Anyone can mint. This is a test helper; do not deploy it anywhere real.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
