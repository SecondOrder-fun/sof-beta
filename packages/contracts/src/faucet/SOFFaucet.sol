// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/access/Ownable.sol";
import "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SOFFaucet
 * @dev A faucet contract for distributing SOF tokens to beta testers
 * Restricted to specific chain IDs (Anvil and Sepolia)
 */
contract SOFFaucet is Ownable, ReentrancyGuard {
    IERC20 public sofToken;

    // Amount of SOF to distribute per request
    uint256 public amountPerRequest;

    // Cooldown period between requests (in seconds)
    uint256 public cooldownPeriod;

    // Track last claim time per address
    mapping(address => uint256) public lastClaimTime;

    // Limit faucet to specific chain IDs (Anvil: 31337, Sepolia: 11155111)
    uint256[] public allowedChainIds;

    event TokensDispensed(address indexed recipient, uint256 amount);
    event AmountPerRequestChanged(uint256 newAmount);
    event CooldownPeriodChanged(uint256 newPeriod);
    event KarmaReceived(address indexed contributor, uint256 amount);
    
    // Debug events
    event DebugLog(string label, uint256 value);
    event DebugAddress(string label, address value);

    constructor(
        address _sofToken,
        uint256 _amountPerRequest,
        uint256 _cooldownPeriod,
        uint256[] memory _allowedChainIds
    ) Ownable(msg.sender) {
        sofToken = IERC20(_sofToken);
        amountPerRequest = _amountPerRequest;
        cooldownPeriod = _cooldownPeriod;
        allowedChainIds = _allowedChainIds;
    }

    /**
     * @dev Claim SOF tokens from the faucet
     * Requirements:
     * - Must be on an allowed chain (Anvil or Sepolia)
     * - Must not have claimed within the cooldown period
     */
    function claim() external nonReentrant {
        // Check chain ID
        bool validChain = false;
        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        // DEBUG: Log chain ID and allowed chains
        emit DebugLog("Current chain ID", chainId);
        emit DebugLog("Allowed chains count", allowedChainIds.length);
        for (uint256 i = 0; i < allowedChainIds.length; i++) {
            emit DebugLog("Allowed chain", allowedChainIds[i]);
            if (chainId == allowedChainIds[i]) {
                validChain = true;
                break;
            }
        }
        require(validChain, "Faucet not available on this network");

        // Check cooldown period
        uint256 lastClaim = lastClaimTime[msg.sender];
        uint256 nextClaimTime = lastClaim + cooldownPeriod;
        emit DebugLog("Last claim time", lastClaim);
        emit DebugLog("Cooldown period", cooldownPeriod);
        emit DebugLog("Next claim time", nextClaimTime);
        emit DebugLog("Current block timestamp", block.timestamp);
        
        require(
            block.timestamp >= nextClaimTime || lastClaim == 0,
            "Cooldown period not yet passed"
        );

        // DEBUG: Log amount and balance
        emit DebugLog("Amount per request", amountPerRequest);
        uint256 faucetBalance = sofToken.balanceOf(address(this));
        emit DebugLog("Faucet balance", faucetBalance);
        emit DebugAddress("SOF token address", address(sofToken));
        emit DebugAddress("Recipient address", msg.sender);

        // Update last claim time
        lastClaimTime[msg.sender] = block.timestamp;

        // Transfer tokens
        bool transferSuccess = sofToken.transfer(msg.sender, amountPerRequest);
        emit DebugLog("Transfer success", transferSuccess ? 1 : 0);
        require(transferSuccess, "Token transfer failed");

        emit TokensDispensed(msg.sender, amountPerRequest);
    }

    /**
     * @dev Update the SOF token address (in case wrong token was set during deployment)
     * @param _sofToken New SOF token address
     */
    function setSofToken(address _sofToken) external onlyOwner {
        require(_sofToken != address(0), "Invalid token address");
        sofToken = IERC20(_sofToken);
    }

    /**
     * @dev Set the amount of tokens to distribute per request
     * @param _amount New amount per request
     */
    function setAmountPerRequest(uint256 _amount) external onlyOwner {
        amountPerRequest = _amount;
        emit AmountPerRequestChanged(_amount);
    }

    /**
     * @dev Set the cooldown period between claims
     * @param _period New cooldown period in seconds
     */
    function setCooldownPeriod(uint256 _period) external onlyOwner {
        cooldownPeriod = _period;
        emit CooldownPeriodChanged(_period);
    }

    /**
     * @dev Withdraw tokens from the faucet (owner only)
     * @param _amount Amount to withdraw
     */
    function withdrawTokens(uint256 _amount) external onlyOwner {
        require(sofToken.transfer(owner(), _amount), "Token transfer failed");
    }

    /**
     * @dev Contribute SOF tokens back to the faucet (karma)
     * @param _amount Amount to contribute
     */
    function contributeKarma(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Amount must be positive");

        // Transfer tokens from sender to faucet
        require(sofToken.transferFrom(msg.sender, address(this), _amount), "Token transfer failed");

        emit KarmaReceived(msg.sender, _amount);
    }
}
