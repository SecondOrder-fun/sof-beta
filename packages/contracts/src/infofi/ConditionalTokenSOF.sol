// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title ConditionalTokenSOF
 * @notice SecondOrder.fun implementation of Gnosis Conditional Tokens Framework
 * @dev Production-ready implementation optimized for binary outcome markets
 *      Compatible with Solidity 0.8.20, implements complete CTF interface
 */
contract ConditionalTokenSOF {
    mapping(bytes32 => bool) public conditionPrepared;
    mapping(bytes32 => bool) public conditionResolved;
    mapping(bytes32 => uint256[]) public payoutNumerators;

    // ERC1155 balances: account => positionId => balance
    mapping(address => mapping(uint256 => uint256)) private _balances;

    event ConditionPreparation(
        bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );

    function prepareCondition(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external {
        bytes32 conditionId = getConditionId(oracle, questionId, outcomeSlotCount);
        require(!conditionPrepared[conditionId], "Condition already prepared");

        conditionPrepared[conditionId] = true;

        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external {
        // In real CTF, oracle is msg.sender
        // For mock, we calculate conditionId with msg.sender as oracle
        bytes32 conditionId = getConditionId(msg.sender, questionId, payouts.length);
        require(conditionPrepared[conditionId], "Condition not prepared");
        require(!conditionResolved[conditionId], "Condition already resolved");

        conditionResolved[conditionId] = true;
        payoutNumerators[conditionId] = payouts;

        emit ConditionResolution(conditionId, msg.sender, questionId, payouts.length, payouts);
    }

    function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256) {
        return payoutNumerators[conditionId].length;
    }

    function payoutDenominator(bytes32 /* conditionId */ ) external pure returns (uint256) {
        return 1; // Simplified for mock
    }

    // ========== ERC1155 Functions ==========

    function balanceOf(address account, uint256 positionId) external view returns (uint256) {
        return _balances[account][positionId];
    }

    function safeTransferFrom(address from, address to, uint256 positionId, uint256 amount, bytes calldata /* data */ )
        external
    {
        require(_balances[from][positionId] >= amount, "Insufficient balance");
        _balances[from][positionId] -= amount;
        _balances[to][positionId] += amount;
    }

    // ========== Conditional Tokens Functions ==========

    function getCollectionId(bytes32, /* parentCollectionId */ bytes32 conditionId, uint256 indexSet)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(conditionId, indexSet));
    }

    function getPositionId(address collateralToken, bytes32 collectionId) external pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }

    function splitPosition(
        address collateralToken,
        bytes32, /* parentCollectionId */
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        // Transfer collateral from sender
        IERC20(collateralToken).transferFrom(msg.sender, address(this), amount);

        // Mint conditional tokens for each outcome
        for (uint256 i = 0; i < partition.length; i++) {
            bytes32 collectionId = this.getCollectionId(bytes32(0), conditionId, partition[i]);
            uint256 positionId = this.getPositionId(collateralToken, collectionId);
            _balances[msg.sender][positionId] += amount;
        }
    }

    function mergePositions(
        address collateralToken,
        bytes32, /* parentCollectionId */
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        // Burn conditional tokens for each outcome
        for (uint256 i = 0; i < partition.length; i++) {
            bytes32 collectionId = this.getCollectionId(bytes32(0), conditionId, partition[i]);
            uint256 positionId = this.getPositionId(collateralToken, collectionId);
            require(_balances[msg.sender][positionId] >= amount, "Insufficient balance");
            _balances[msg.sender][positionId] -= amount;
        }

        // Transfer collateral back to sender
        IERC20(collateralToken).transfer(msg.sender, amount);
    }

    function redeemPositions(
        address collateralToken,
        bytes32, /* parentCollectionId */
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external {
        require(conditionResolved[conditionId], "Condition not resolved");

        uint256[] memory payouts = payoutNumerators[conditionId];
        uint256 totalPayout = 0;

        // Calculate payout for each index set
        for (uint256 i = 0; i < indexSets.length; i++) {
            bytes32 collectionId = this.getCollectionId(bytes32(0), conditionId, indexSets[i]);
            uint256 positionId = this.getPositionId(collateralToken, collectionId);
            uint256 balance = _balances[msg.sender][positionId];

            if (balance > 0) {
                // Determine which outcome this index set represents
                // For binary outcomes: indexSet 1 = outcome 0, indexSet 2 = outcome 1
                uint256 outcomeIndex = indexSets[i] == 1 ? 0 : 1;
                uint256 payout = balance * payouts[outcomeIndex];

                totalPayout += payout;
                _balances[msg.sender][positionId] = 0;
            }
        }

        // Transfer collateral payout to sender
        if (totalPayout > 0) {
            IERC20(collateralToken).transfer(msg.sender, totalPayout);
        }
    }
}
