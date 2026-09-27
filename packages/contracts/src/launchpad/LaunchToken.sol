// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title LaunchToken
 * @notice A token launched on the SecondOrder launchpad.
 *
 * @dev Deliberately minimal and deliberately ownerless. The creator of a launched token
 *      is an anonymous stranger, so this contract gives them no powers at all: no mint,
 *      no pause, no blocklist, no metadata mutation, no upgrade path. Everything that
 *      could be abused is simply absent rather than access-controlled.
 *
 *      Properties the rest of the system relies on:
 *
 *      - **18 decimals.** `Raffle` asserts this when a season names a quote token, which
 *        is what keeps the pricing path to a single decimal pair (18 quote / 0 ticket).
 *      - **ERC-2612 permit.** The ticket curve tries permit before falling back to
 *        approve, so having it saves users a transaction.
 *      - **Fixed supply, minted once, at construction.** There is no `mint`, so supply is
 *        provably fixed from the first block. The launchpad receives the whole supply and
 *        places it; see `TokenLaunchpad`.
 *
 *      Metadata (image, description, socials) lives off-chain against the launchpad's
 *      registry, not here — keeping it on-chain would either cost a fortune or need a
 *      setter, and a setter is a rug vector for name/image swaps after the fact.
 */
contract LaunchToken is ERC20, ERC20Permit {
    /// @notice The address that launched this token. Informational only: it confers no
    ///         rights whatsoever on this contract.
    address public immutable creator;

    /// @notice The launchpad that deployed this token and received its supply.
    address public immutable launchpad;

    /**
     * @param name_        Token name.
     * @param symbol_      Token symbol.
     * @param totalSupply_ Entire supply, minted to `msg.sender` (the launchpad).
     * @param creator_     The launching address, recorded for attribution only.
     */
    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address creator_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        creator = creator_;
        launchpad = msg.sender;
        _mint(msg.sender, totalSupply_);
    }
}
