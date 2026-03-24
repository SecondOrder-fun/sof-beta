// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/access/AccessControl.sol";

/**
 * @title InfoFiSettlement
 * @notice Minimal MVP settlement contract to mark markets as settled
 */
contract InfoFiSettlement is AccessControl {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    struct Outcome {
        address winner; // winner address from raffle layer (if applicable)
        bool settled;
        uint256 settledAt;
    }

    // marketId => outcome
    mapping(bytes32 => Outcome) public outcomes;

    event MarketsSettled(address indexed winner, bytes32[] marketIds, uint256 timestamp);

    constructor(address _admin, address _settler) {
        address admin = _admin == address(0) ? msg.sender : _admin;
        _grantRole(ADMIN_ROLE, admin);
        if (_settler != address(0)) {
            _grantRole(SETTLER_ROLE, _settler);
        }
    }

    /**
     * @notice Mark a list of markets as settled. MVP only tracks settlement state.
     */
    function settleMarkets(address winner, bytes32[] calldata marketIds) external onlyRole(SETTLER_ROLE) {
        uint256 ts = block.timestamp;
        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 id = marketIds[i];
            outcomes[id] = Outcome({winner: winner, settled: true, settledAt: ts});
        }
        emit MarketsSettled(winner, marketIds, ts);
    }

    function isSettled(bytes32 marketId) external view returns (bool) {
        return outcomes[marketId].settled;
    }
}
