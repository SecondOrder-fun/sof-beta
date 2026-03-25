---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 4

#### InfoFiSettlement.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";

/**
 * @title InfoFiSettlement
 * @dev Handles automated settlement of InfoFi prediction markets triggered by VRF
 */
contract InfoFiSettlement is AccessControl, ReentrancyGuard, VRFConsumerBaseV2Plus {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    
    struct MarketOutcome {
        bytes32 marketId;
        address winner;
        bool settled;
        uint256 settlementTime;
        uint256 totalPayout;
    }
    
    mapping(bytes32 => MarketOutcome) public marketOutcomes;
    mapping(address => mapping(bytes32 => uint256)) public userWinnings; // user => marketId => amount
    mapping(uint256 => bytes32[]) public vrfRequestToMarkets; // VRF requestId => market IDs
    
    address public immutable raffleContract;
    address public immutable marketFactory;
    
    event MarketsSettled(
        address indexed winner,
        uint256 marketCount,
        uint256 totalPayout
    );
    
    event WinningsClaimed(
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount
    );
    
    event SettlementInitiated(
        uint256 indexed vrfRequestId,
        bytes32[] marketIds
    );

    constructor(
        address vrfCoordinator,
        address _raffleContract,
        address _marketFactory
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SETTLER_ROLE, _raffleContract); // Raffle contract can trigger settlement
        
        raffleContract = _raffleContract;
        marketFactory = _marketFactory;
    }
    
    /**
     * @dev Initiate settlement for all active markets
     * Called by RaffleBondingCurve when VRF determines winner
     */
    function settleMarkets(
        address winner,
        bytes32[] calldata marketIds
    ) external onlyRole(SETTLER_ROLE) nonReentrant {
        require(winner != address(0), "Invalid winner");
        require(marketIds.length > 0, "No markets to settle");
        
        uint256 totalPayout = 0;
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 marketId = marketIds[i];
            MarketOutcome storage outcome = marketOutcomes[marketId];
            
            require(!outcome.settled, "Market already settled");
            
            outcome.winner = winner;
            outcome.settled = true;
            outcome.settlementTime = block.timestamp;
            
            // Calculate and distribute winnings
            uint256 payout = _calculateAndDistributeWinnings(marketId, winner);
            outcome.totalPayout = payout;
            totalPayout += payout;
        }
        
        emit MarketsSettled(winner, marketIds.length, totalPayout);
    }
    
    /**
     * @dev Calculate winnings for a settled market
     */
    function _calculateAndDistributeWinnings(
        bytes32 marketId,
        address winner
    ) internal returns (uint256) {
        // Implementation would depend on chosen InfoFi framework
        // This is a placeholder for the actual calculation logic
        
        // For winner prediction markets:
        // - Users who bet "YES" on the actual winner get payouts
        // - Users who bet "NO" on non-winners get payouts
        // - Payout = (user's position / total winning positions) * total pool
        
        // For position size markets:
        // - Based on whether winner's final position matched predictions
        
        // For behavioral markets:
        // - Based on whether winner exhibited predicted behavior
        
        return 0; // Placeholder
    }
    
    /**
     * @dev Users claim their winnings from settled markets
     */
    function claimWinnings(bytes32 marketId) external nonReentrant {
        require(marketOutcomes[marketId].settled, "Market not settled");
        
        uint256 winnings = userWinnings[msg.sender][marketId];
        require(winnings > 0, "No winnings to claim");
        
        userWinnings[msg.sender][marketId] = 0;
        
        // Transfer winnings (implementation depends on token used)
        // payable(msg.sender).transfer(winnings); // For ETH
        // or IERC20(paymentToken).transfer(msg.sender, winnings); // For ERC20
        
        emit WinningsClaimed(msg.sender, marketId, winnings);
    }
    
    /**
     * @dev Bulk claim winnings from multiple markets
     */
    function claimMultipleWinnings(bytes32[] calldata marketIds) external nonReentrant {
        uint256 totalWinnings = 0;
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 marketId = marketIds[i];
            require(marketOutcomes[marketId].settled, "Market not settled");
            
            uint256 winnings = userWinnings[msg.sender][marketId];
            if (winnings > 0) {
                userWinnings[msg.sender][marketId] = 0;
                totalWinnings += winnings;
                
                emit WinningsClaimed(msg.sender, marketId, winnings);
            }
        }
        
        require(totalWinnings > 0, "No winnings to claim");
        
        // Transfer total winnings
        // Implementation depends on payment token
    }
    
    /**
     * @dev Get user's total claimable winnings across all markets
     */
    function getTotalClaimableWinnings(address user) external view returns (uint256) {
        // Implementation would iterate through user's positions
        // This is a placeholder for the actual calculation
        return 0;
    }
    
    /**
     * @dev Emergency function to settle markets manually (admin only)
     */
    function emergencySettleMarket(
        bytes32 marketId,
        address winner
    ) external onlyRole(ADMIN_ROLE) {
        MarketOutcome storage outcome = marketOutcomes[marketId];
        require(!outcome.settled, "Market already settled");
        
        outcome.winner = winner;
        outcome.settled = true;
        outcome.settlementTime = block.timestamp;
        
        uint256 payout = _calculateAndDistributeWinnings(marketId, winner);
        outcome.totalPayout = payout;
    }
}
```