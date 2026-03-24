// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaffleToken {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
}
