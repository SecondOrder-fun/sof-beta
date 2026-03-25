---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 3

#### Enhanced RaffleBondingCurve.sol Integration
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import "./interfaces/IInfoFiMarketFactory.sol";

/**
 * @title RaffleBondingCurve
 * @dev Enhanced with InfoFi integration and VRF automation
 */
contract RaffleBondingCurve is ERC20, AccessControl, VRFConsumerBaseV2Plus {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant VRF_ROLE = keccak256("VRF_ROLE");
    
    struct PlayerPosition {
        uint256 ticketCount;
        uint256 startRange;     // For sliding window system
        uint256 lastUpdate;
    }
    
    mapping(address => PlayerPosition) public positions;
    uint256 public totalTickets;
    bool public tradingLocked;
    address public immutable infoFiFactory;
    
    // VRF Configuration
    uint256 private s_subscriptionId;
    bytes32 private s_keyHash;
    uint32 private constant CALLBACK_GAS_LIMIT = 200000;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;
    
    mapping(uint256 => bool) public s_pendingRequests;
    
    // Events with InfoFi integration
    event PositionUpdate(
        address indexed player,
        uint256 oldTickets,
        uint256 newTickets,
        uint256 totalTickets
    );
    
    event MarketTrigger(
        address indexed player,
        uint256 positionSize,
        uint256 winProbability
    );
    
    event CurveLocked(
        uint256 timestamp,
        uint256 totalValue,
        uint256 vrfRequestId
    );
    
    event WinnerSelected(
        address indexed winner,
        uint256 randomNumber,
        uint256 winningTicket
    );

    constructor(
        string memory name,
        string memory symbol,
        address vrfCoordinator,
        uint256 subscriptionId,
        bytes32 keyHash,
        address _infoFiFactory
    ) 
        ERC20(name, symbol) 
        VRFConsumerBaseV2Plus(vrfCoordinator)
    {
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(VRF_ROLE, vrfCoordinator);
        
        s_subscriptionId = subscriptionId;
        s_keyHash = keyHash;
        infoFiFactory = _infoFiFactory;
    }
    
    /**
     * @dev Buy tickets via bonding curve with InfoFi integration
     */
    function buyTickets(uint256 sofAmount) external {
        require(!tradingLocked, "Trading is locked");
        require(sofAmount > 0, "Amount must be positive");
        
        PlayerPosition storage pos = positions[msg.sender];
        uint256 oldTickets = pos.ticketCount;
        
        // Calculate tickets from bonding curve (simplified linear for demo)
        uint256 newTickets = _calculateTicketsFromSOF(sofAmount);
        
        // Update position
        if (oldTickets == 0) {
            // New player: assign range at end
            pos.startRange = totalTickets;
        }
        pos.ticketCount = oldTickets + newTickets;
        pos.lastUpdate = block.timestamp;
        
        totalTickets += newTickets;
        
        // Mint ticket tokens
        _mint(msg.sender, newTickets);
        
        // Calculate win probability for InfoFi
        uint256 winProbability = (pos.ticketCount * 10000) / totalTickets;
        
        emit PositionUpdate(msg.sender, oldTickets, pos.ticketCount, totalTickets);
        
        // Trigger InfoFi market creation if crossing 1% threshold
        if (winProbability >= 100 && (oldTickets * 10000) / (totalTickets - newTickets) < 100) {
            emit MarketTrigger(msg.sender, pos.ticketCount, winProbability);
            
            // Notify InfoFi factory
            IInfoFiMarketFactory(infoFiFactory).onPositionUpdate(
                msg.sender,
                oldTickets,
                pos.ticketCount,
                totalTickets
            );
        }
    }
    
    /**
     * @dev VRF callback - triggers both raffle resolution and InfoFi settlement
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        require(s_pendingRequests[requestId], "Request not found");
        
        uint256 randomNumber = randomWords[0];
        uint256 winningTicket = (randomNumber % totalTickets) + 1;
        
        // Find winner using sliding window system
        address winner = _findWinnerByTicket(winningTicket);
        
        // Lock trading permanently
        tradingLocked = true;
        
        // Extract prizes and trigger InfoFi settlement
        _extractPrizesAndSettleInfoFi(winner, randomNumber);
        
        emit WinnerSelected(winner, randomNumber, winningTicket);
        
        delete s_pendingRequests[requestId];
    }
    
    /**
     * @dev Find winner by ticket number using sliding window system
     */
    function _findWinnerByTicket(uint256 ticketNumber) internal view returns (address) {
        // Implementation of sliding window winner selection
        // This would iterate through positions to find which range contains the winning ticket
        // Placeholder for actual implementation
        return address(0);
    }
    
    /**
     * @dev Extract prizes and coordinate InfoFi settlement
     */
    function _extractPrizesAndSettleInfoFi(address winner, uint256 randomNumber) internal {
        // Calculate prize distribution
        uint256 totalValue = address(this).balance; // Or SOF token balance
        
        // Extract prizes to RafflePrizeDistributor
        // Implementation depends on prize distribution contract
        
        // Trigger InfoFi settlement via cross-contract call
        // This would call InfoFiSettlement contract to resolve all prediction markets
    }
    
    /**
     * @dev Calculate tickets from SOF amount using bonding curve
     */
    function _calculateTicketsFromSOF(uint256 sofAmount) internal view returns (uint256) {
        // Simplified linear bonding curve for demonstration
        // In practice, this would implement the stepped curve from the analysis
        return sofAmount / 10; // 10 SOF per ticket at base rate
    }
    
    /**
     * @dev Admin function to request VRF for season end
     */
    function requestSeasonEnd() external onlyRole(ADMIN_ROLE) {
        require(!tradingLocked, "Season already ended");
        require(totalTickets > 0, "No tickets sold");
        
        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: s_keyHash,
                subId: s_subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: CALLBACK_GAS_LIMIT,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        
        s_pendingRequests[requestId] = true;
        
        emit CurveLocked(block.timestamp, address(this).balance, requestId);
    }
}
```