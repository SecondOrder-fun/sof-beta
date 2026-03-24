// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/access/AccessControl.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "../lib/RaffleTypes.sol";
import "./RaffleOracleAdapter.sol";
import "./InfoFiFPMMV2.sol";
import "./MarketTypeRegistry.sol";

/**
 * @title InfoFiMarketFactory
 * @notice Auto-creates FPMM-based InfoFi markets when player crosses 1% threshold
 * @dev Integrates Gnosis CTF + FPMM for proper prediction market mechanics
 *
 * V2 Changes (FPMM Migration):
 * - Replaced CSMM with SimpleFPMM (x * y = k invariant)
 * - Integrated Gnosis Conditional Token Framework via interfaces
 * - Added RaffleOracleAdapter for VRF-based resolution
 * - Automatic 100 SOF liquidity provision per market from treasury
 * - SOLP token rewards for liquidity providers
 * - 2% trading fee (100% to protocol treasury initially)
 *
 * Phase 3: Polish - Enhanced Error Handling & Defensive Programming
 * - Custom errors for all failure modes (gas-efficient)
 * - Comprehensive input validation
 * - Defensive approval pattern for token compatibility
 * - Structured event logging with contextual data
 * - Full NatSpec documentation
 *
 * V3 Changes (Registry Pattern):
 * - Integrated MarketTypeRegistry for dynamic market type management
 * - No factory redeployment needed for new market types
 * - On-chain validation of market types
 * - Backward compatible with existing WINNER_PREDICTION constant
 * @custom:security-contact security@secondorder.fun
 */
contract InfoFiMarketFactory is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant RAFFLE_ROLE = keccak256("RAFFLE_ROLE");
    bytes32 public constant PAYMASTER_ROLE = keccak256("PAYMASTER_ROLE");

    // Market creation status tracking
    enum MarketCreationStatus {
        NotStarted,
        ConditionPrepared,
        LiquidityTransferred,
        MarketCreated,
        Failed
    }

    IRaffleRead public immutable raffle;
    IInfoFiPriceOracleMinimal public immutable oracle;
    RaffleOracleAdapter public immutable oracleAdapter;
    InfoFiFPMMV2 public immutable fpmmManager;
    IERC20 public immutable sofToken;
    MarketTypeRegistry public marketTypeRegistry;

    address public treasury;

    uint256 public constant THRESHOLD_BPS = 100;
    uint256 public constant INITIAL_LIQUIDITY = 100e18;
    bytes32 public constant WINNER_PREDICTION = keccak256("WINNER_PREDICTION");

    mapping(uint256 => mapping(address => bool)) public marketCreated;
    mapping(uint256 => mapping(address => bytes32)) public playerConditions;
    mapping(uint256 => mapping(address => address)) public playerMarkets;
    mapping(uint256 => address[]) private _seasonPlayers;

    // High-priority robustness improvements
    mapping(uint256 => mapping(address => MarketCreationStatus)) public marketStatus;
    mapping(uint256 => mapping(address => string)) public marketFailureReason;

    // ============ EVENTS ============

    /// @notice Emitted when a market is successfully created
    event MarketCreated(
        uint256 indexed seasonId, address indexed player, bytes32 marketType, bytes32 conditionId, address fpmmAddress
    );

    /// @notice Emitted when a player's win probability is updated
    event ProbabilityUpdated(
        uint256 indexed seasonId, address indexed player, uint256 oldProbabilityBps, uint256 newProbabilityBps
    );

    /// @notice Emitted when market creation fails
    event MarketCreationFailed(
        uint256 indexed seasonId, address indexed player, bytes32 indexed marketType, string reason
    );

    /// @notice Emitted when all markets for a season are resolved
    event SeasonMarketsResolved(uint256 indexed seasonId, address indexed winner, uint256 marketCount);

    /// @notice Emitted when treasury address is updated
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @notice Emitted when market type registry is updated
    event MarketTypeRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    /// @notice Emitted when treasury balance is low
    event TreasuryLow(uint256 currentBalance, uint256 requiredPerMarket);

    /// @notice Emitted when market creation status changes
    event MarketStatusChanged(
        uint256 indexed seasonId,
        address indexed player,
        MarketCreationStatus oldStatus,
        MarketCreationStatus newStatus,
        string reason
    );

    // ============ CUSTOM ERRORS (Gas-Efficient) ============

    /// @notice Thrown when an invalid address (zero address) is provided
    error InvalidAddress();

    /// @notice Thrown when treasury balance is insufficient for market creation
    error InsufficientTreasuryBalance();

    /// @notice Thrown when attempting to create a market that already exists
    error MarketAlreadyCreated();

    /// @notice Thrown when attempting to retry a market that is not in failed state
    error NotInFailedState();

    /// @notice Thrown when total tickets is zero (division by zero protection)
    error ZeroTotalTickets();

    /// @notice Thrown when an invalid market type is provided
    error InvalidMarketType(bytes32 marketType);

    /// @notice Thrown when condition preparation fails
    error ConditionPreparationFailed();

    /// @notice Thrown when liquidity transfer fails
    error LiquidityTransferFailed();

    /// @notice Thrown when token approval fails
    error ApprovalFailed();

    /// @notice Thrown when market creation fails in FPMM manager
    error MarketCreationInternalFailed();

    /// @notice Thrown when caller is not authorized
    error UnauthorizedCaller();

    // ============ CONSTRUCTOR ============

    /**
     * @notice Initializes the InfoFi Market Factory with all required dependencies
     * @dev All addresses are validated to prevent zero-address initialization
     * @param _raffle Address of the Raffle contract (must have RAFFLE_ROLE)
     * @param _oracle Address of the InfoFi Price Oracle
     * @param _oracleAdapter Address of the Raffle Oracle Adapter
     * @param _fpmmManager Address of the FPMM Manager contract
     * @param _sofToken Address of the SOF token contract
     * @param _marketTypeRegistry Address of the Market Type Registry
     * @param _treasury Address of the treasury (receives TREASURY_ROLE)
     * @param _admin Address of the admin (receives ADMIN_ROLE)
     */
    constructor(
        address _raffle,
        address _oracle,
        address _oracleAdapter,
        address _fpmmManager,
        address _sofToken,
        address _marketTypeRegistry,
        address _treasury,
        address _admin
    ) {
        if (_raffle == address(0)) revert InvalidAddress();
        if (_oracle == address(0)) revert InvalidAddress();
        if (_oracleAdapter == address(0)) revert InvalidAddress();
        if (_fpmmManager == address(0)) revert InvalidAddress();
        if (_sofToken == address(0)) revert InvalidAddress();
        if (_marketTypeRegistry == address(0)) revert InvalidAddress();
        if (_treasury == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();

        raffle = IRaffleRead(_raffle);
        oracle = IInfoFiPriceOracleMinimal(_oracle);
        oracleAdapter = RaffleOracleAdapter(_oracleAdapter);
        fpmmManager = InfoFiFPMMV2(_fpmmManager);
        sofToken = IERC20(_sofToken);
        marketTypeRegistry = MarketTypeRegistry(_marketTypeRegistry);
        treasury = _treasury;

        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(TREASURY_ROLE, _treasury);
        _grantRole(RAFFLE_ROLE, _raffle);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Sets the Paymaster Smart Account address
     * @dev Only callable by admin. Grants PAYMASTER_ROLE to the account.
     * @param paymasterAccount The address of the backend Smart Account controlled by Paymaster
     */
    function setPaymasterAccount(address paymasterAccount) external onlyRole(ADMIN_ROLE) {
        if (paymasterAccount == address(0)) revert InvalidAddress();
        grantRole(PAYMASTER_ROLE, paymasterAccount);
    }

    // ============ MAIN FUNCTIONS ============

    /**
     * @notice Called by Backend Paymaster Service when a participant's position changes
     * @dev This function is now called via gasless transaction sponsored by Base Paymaster
     * @dev Automatically creates InfoFi markets when player crosses 1% threshold
     * @dev Monitors treasury balance and emits warning if depleted
     * @param seasonId The season identifier
     * @param player The player address whose position changed
     * @param oldTickets The player's previous ticket count
     * @param newTickets The player's new ticket count
     * @param totalTickets The total tickets in the season after update
     */
    function onPositionUpdate(
        uint256 seasonId,
        address player,
        uint256 oldTickets,
        uint256 newTickets,
        uint256 totalTickets
    ) external onlyRole(PAYMASTER_ROLE) nonReentrant {
        // ✅ INPUT VALIDATION
        if (player == address(0)) revert InvalidAddress();
        if (totalTickets == 0) revert ZeroTotalTickets();

        // ✅ CALCULATE PROBABILITIES
        uint256 oldBps = (oldTickets * 10000) / totalTickets;
        uint256 newBps = (newTickets * 10000) / totalTickets;

        // ✅ EMIT PROBABILITY UPDATE EVENT
        emit ProbabilityUpdated(seasonId, player, oldBps, newBps);

        // ✅ MONITOR TREASURY BALANCE
        uint256 treasuryBalance = sofToken.balanceOf(treasury);
        if (treasuryBalance < INITIAL_LIQUIDITY * 10) {
            emit TreasuryLow(treasuryBalance, INITIAL_LIQUIDITY);
        }

        // ✅ CREATE MARKET IF THRESHOLD CROSSED
        if (newBps >= THRESHOLD_BPS && oldBps < THRESHOLD_BPS && !marketCreated[seasonId][player]) {
            _createMarket(seasonId, player, newBps);
        }
    }

    /**
     * @notice Internal function to initiate market creation with error handling
     * @dev Uses try-catch to gracefully handle failures and emit events
     * @param seasonId The season identifier
     * @param player The player address
     */
    function _createMarket(uint256 seasonId, address player, uint256 probabilityBps) internal {
        // ✅ DETERMINE MARKET TYPE
        // For now, always use WINNER_PREDICTION (backward compatible)
        // In future, can add logic to determine different market types based on criteria
        bytes32 marketType = WINNER_PREDICTION;

        // ✅ CHECK TREASURY BALANCE BEFORE ATTEMPTING CREATION
        if (sofToken.balanceOf(treasury) < INITIAL_LIQUIDITY) {
            marketStatus[seasonId][player] = MarketCreationStatus.Failed;
            marketFailureReason[seasonId][player] = "Insufficient treasury balance";
            emit MarketCreationFailed(seasonId, player, marketType, "Insufficient treasury balance");
            return;
        }

        // ✅ ATTEMPT MARKET CREATION WITH ERROR HANDLING
        try this._createMarketInternal(seasonId, player, marketType, probabilityBps) {
            // Success - status already updated in _createMarketInternal
        } catch Error(string memory reason) {
            // Solidity error with message
            marketStatus[seasonId][player] = MarketCreationStatus.Failed;
            marketFailureReason[seasonId][player] = reason;
            emit MarketCreationFailed(seasonId, player, marketType, reason);
        } catch (bytes memory lowLevelData) {
            // Low-level error - decode if possible
            string memory reason = "Unknown error";
            if (lowLevelData.length > 0) {
                // Attempt to decode revert reason
                try this._decodeRevertReason(lowLevelData) returns (string memory decoded) {
                    reason = decoded;
                } catch {}
            }
            marketStatus[seasonId][player] = MarketCreationStatus.Failed;
            marketFailureReason[seasonId][player] = reason;
            emit MarketCreationFailed(seasonId, player, marketType, reason);
        }
    }

    /**
     * @notice Internal function to decode low-level revert reasons
     * @dev Helper for error handling in try-catch blocks
     * @param data The encoded revert data
     * @return The decoded error message
     */
    function _decodeRevertReason(bytes memory data) external pure returns (string memory) {
        if (data.length == 0) return "Empty revert data";
        if (data.length < 4) return "Invalid revert data";

        // Extract the error selector (first 4 bytes) - simple high-level approach
        bytes4 errorSelector = bytes4(data);

        // Map custom error selectors to human-readable messages
        if (errorSelector == InvalidAddress.selector) return "InvalidAddress";
        if (errorSelector == InsufficientTreasuryBalance.selector) return "InsufficientTreasuryBalance";
        if (errorSelector == MarketAlreadyCreated.selector) return "MarketAlreadyCreated";
        if (errorSelector == NotInFailedState.selector) return "NotInFailedState";
        if (errorSelector == ZeroTotalTickets.selector) return "ZeroTotalTickets";
        if (errorSelector == ConditionPreparationFailed.selector) return "ConditionPreparationFailed";
        if (errorSelector == LiquidityTransferFailed.selector) return "LiquidityTransferFailed";
        if (errorSelector == ApprovalFailed.selector) return "ApprovalFailed";
        if (errorSelector == MarketCreationInternalFailed.selector) return "MarketCreationInternalFailed";
        if (errorSelector == UnauthorizedCaller.selector) return "UnauthorizedCaller";

        // Check for InvalidMarketType (has parameter)
        if (errorSelector == InvalidMarketType.selector) {
            if (data.length >= 36) {
                return "InvalidMarketType";
            }
        }

        // Try to decode as Error(string) for require() messages
        if (data.length >= 68 && errorSelector == 0x08c379a0) {
            // Skip the first 4 bytes (selector) and decode the string
            bytes memory errorData = new bytes(data.length - 4);
            for (uint256 i = 0; i < errorData.length; i++) {
                errorData[i] = data[i + 4];
            }
            return abi.decode(errorData, (string));
        }

        // Return hex representation of unknown selector
        return string(abi.encodePacked("Unknown error: 0x", _toHexString(uint32(errorSelector))));
    }

    /**
     * @notice Converts uint32 to hex string
     * @param value The uint32 value to convert
     * @return The hex string representation
     */
    function _toHexString(uint32 value) internal pure returns (string memory) {
        bytes memory buffer = new bytes(8);
        for (uint256 i = 8; i > 0; --i) {
            buffer[i - 1] = _toHexChar(uint8(value & 0xf));
            value >>= 4;
        }
        return string(buffer);
    }

    /**
     * @notice Converts a uint8 to its hex character
     * @param value The uint8 value (0-15)
     * @return The hex character
     */
    function _toHexChar(uint8 value) internal pure returns (bytes1) {
        if (value < 10) {
            return bytes1(uint8(bytes1("0")) + value);
        }
        return bytes1(uint8(bytes1("a")) + value - 10);
    }

    /**
     * @notice Internal function to create a market for a player
     * @param seasonId The season identifier
     * @param player The player address
     * @param marketType The type of market to create (validated against registry)
     */
    function _createMarketInternal(uint256 seasonId, address player, bytes32 marketType, uint256 probabilityBps) external {
        // ✅ AUTHORIZATION CHECK
        if (msg.sender != address(this)) revert UnauthorizedCaller();

        // ✅ VALIDATE MARKET TYPE
        if (!marketTypeRegistry.isValidMarketType(marketType)) {
            revert InvalidMarketType(marketType);
        }

        // ✅ PRECONDITION CHECKS (before any state changes)
        require(sofToken.balanceOf(treasury) >= INITIAL_LIQUIDITY, "Insufficient treasury");
        require(!marketCreated[seasonId][player], "Market already created");

        // ✅ STEP 1: PREPARE CONDITION (or reuse if already prepared)
        MarketCreationStatus oldStatus = marketStatus[seasonId][player];
        bytes32 conditionId = playerConditions[seasonId][player];

        if (conditionId == bytes32(0)) {
            // Condition not yet prepared, prepare it now
            marketStatus[seasonId][player] = MarketCreationStatus.ConditionPrepared;
            emit MarketStatusChanged(
                seasonId, player, oldStatus, MarketCreationStatus.ConditionPrepared, "Condition prepared"
            );

            conditionId = oracleAdapter.preparePlayerCondition(seasonId, player);
        } else {
            // Condition already prepared (idempotent retry scenario)
            // Update status to reflect we're reusing it
            marketStatus[seasonId][player] = MarketCreationStatus.ConditionPrepared;
            emit MarketStatusChanged(
                seasonId, player, oldStatus, MarketCreationStatus.ConditionPrepared, "Reusing existing condition"
            );
        }

        // ✅ STEP 2: TRANSFER LIQUIDITY
        oldStatus = marketStatus[seasonId][player];

        // Check treasury allowance first
        uint256 treasuryAllowance = sofToken.allowance(treasury, address(this));
        require(
            treasuryAllowance >= INITIAL_LIQUIDITY,
            string(
                abi.encodePacked(
                    "Treasury allowance insufficient: has ",
                    _uint2str(treasuryAllowance),
                    " needs ",
                    _uint2str(INITIAL_LIQUIDITY)
                )
            )
        );

        // Check treasury balance
        uint256 treasuryBalance = sofToken.balanceOf(treasury);
        require(
            treasuryBalance >= INITIAL_LIQUIDITY,
            string(
                abi.encodePacked(
                    "Treasury balance insufficient: has ",
                    _uint2str(treasuryBalance),
                    " needs ",
                    _uint2str(INITIAL_LIQUIDITY)
                )
            )
        );

        marketStatus[seasonId][player] = MarketCreationStatus.LiquidityTransferred;
        emit MarketStatusChanged(
            seasonId, player, oldStatus, MarketCreationStatus.LiquidityTransferred, "Starting liquidity transfer"
        );

        bool transferSuccess = sofToken.transferFrom(treasury, address(this), INITIAL_LIQUIDITY);
        require(transferSuccess, "Treasury transfer failed - transferFrom returned false");

        // ✅ STEP 3: APPROVE AND CREATE MARKET
        // Use defensive approval pattern: reset to 0 first, then approve exact amount
        // This prevents issues with certain token implementations that don't allow increasing allowance
        uint256 currentAllowance = sofToken.allowance(address(this), address(fpmmManager));
        if (currentAllowance > 0) {
            require(sofToken.approve(address(fpmmManager), 0), "Approval reset failed");
        }
        require(sofToken.approve(address(fpmmManager), INITIAL_LIQUIDITY), "Approval failed");

        (address fpmm,) = fpmmManager.createMarket(seasonId, player, conditionId, probabilityBps);

        // ✅ STEP 4: SET ALL STATE AT END
        marketCreated[seasonId][player] = true;
        playerConditions[seasonId][player] = conditionId;
        playerMarkets[seasonId][player] = fpmm;
        _seasonPlayers[seasonId].push(player);

        oldStatus = marketStatus[seasonId][player];
        marketStatus[seasonId][player] = MarketCreationStatus.MarketCreated;
        emit MarketStatusChanged(
            seasonId, player, oldStatus, MarketCreationStatus.MarketCreated, "Market created successfully"
        );

        emit MarketCreated(seasonId, player, marketType, conditionId, fpmm);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Resolves all markets for a season with a winner
     * @dev Only callable by admin, triggers oracle resolution for all markets
     * @param seasonId The season identifier
     * @param winner The winner address
     */
    function resolveSeasonMarkets(uint256 seasonId, address winner) external onlyRole(ADMIN_ROLE) nonReentrant {
        // ✅ INPUT VALIDATION
        if (winner == address(0)) revert InvalidAddress();

        address[] memory players = _seasonPlayers[seasonId];
        if (players.length == 0) revert("No markets to resolve");

        // ✅ RESOLVE MARKETS VIA ORACLE ADAPTER
        oracleAdapter.batchResolveSeasonMarkets(seasonId, players, winner);

        // ✅ EMIT RESOLUTION EVENT
        emit SeasonMarketsResolved(seasonId, winner, players.length);
    }

    /**
     * @notice Updates the treasury address and roles
     * @dev Revokes TREASURY_ROLE from old address, grants to new address
     * @param newTreasury The new treasury address
     */
    function setTreasury(address newTreasury) external onlyRole(ADMIN_ROLE) {
        // ✅ INPUT VALIDATION
        if (newTreasury == address(0)) revert InvalidAddress();

        address oldTreasury = treasury;
        treasury = newTreasury;

        // ✅ UPDATE ROLES
        _revokeRole(TREASURY_ROLE, oldTreasury);
        _grantRole(TREASURY_ROLE, newTreasury);

        // ✅ EMIT UPDATE EVENT
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Updates the MarketTypeRegistry address
     * @dev Only callable by admin, allows updating registry without redeploying factory
     * @param newRegistry The new MarketTypeRegistry address
     */
    function setMarketTypeRegistry(address newRegistry) external onlyRole(ADMIN_ROLE) {
        // ✅ INPUT VALIDATION
        if (newRegistry == address(0)) revert InvalidAddress();

        address oldRegistry = address(marketTypeRegistry);
        marketTypeRegistry = MarketTypeRegistry(newRegistry);

        // ✅ EMIT UPDATE EVENT
        emit MarketTypeRegistryUpdated(oldRegistry, newRegistry);
    }

    /**
     * @notice Retries market creation for a failed market
     * @dev Only callable by admin, allows recovery from transient failures
     * @param seasonId The season identifier
     * @param player The player address
     */
    function retryMarketCreation(uint256 seasonId, address player) external onlyRole(ADMIN_ROLE) {
        // ✅ VALIDATION: Market must not already exist
        if (marketCreated[seasonId][player]) revert MarketAlreadyCreated();

        // ✅ VALIDATION: Market must be in failed state
        if (marketStatus[seasonId][player] != MarketCreationStatus.Failed) revert NotInFailedState();

        // ✅ CALCULATE CURRENT PROBABILITY FROM ON-CHAIN STATE
        (,,, uint256 totalTickets,) = raffle.getSeasonDetails(seasonId);
        uint256 probabilityBps = 5000; // default 50% if no data
        if (totalTickets > 0) {
            IRaffleRead.ParticipantPosition memory pos = raffle.getParticipantPosition(seasonId, player);
            probabilityBps = (pos.ticketCount * 10000) / totalTickets;
        }

        // ✅ RETRY MARKET CREATION
        _createMarket(seasonId, player, probabilityBps);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Returns all players who have markets in a season
     * @param seasonId The season identifier
     * @return Array of player addresses
     */
    function getSeasonPlayers(uint256 seasonId) external view returns (address[] memory) {
        return _seasonPlayers[seasonId];
    }

    /**
     * @notice Returns market details for a specific player
     * @param seasonId The season identifier
     * @param player The player address
     * @return created Whether the market has been created
     * @return conditionId The Gnosis condition ID
     * @return fpmmAddress The FPMM market address
     */
    function getPlayerMarket(uint256 seasonId, address player)
        external
        view
        returns (bool created, bytes32 conditionId, address fpmmAddress)
    {
        created = marketCreated[seasonId][player];
        conditionId = playerConditions[seasonId][player];
        fpmmAddress = playerMarkets[seasonId][player];
    }

    /**
     * @notice Calculates the current win probability for a player
     * @dev Reads from raffle contract to get current position and total tickets
     * @param seasonId The season identifier
     * @param player The player address
     * @return probabilityBps The win probability in basis points (0-10000)
     */
    function getPlayerProbability(uint256 seasonId, address player) external view returns (uint256 probabilityBps) {
        // ✅ GET SEASON DETAILS
        (,,, uint256 totalTickets,) = raffle.getSeasonDetails(seasonId);

        // ✅ HANDLE ZERO TOTAL TICKETS
        if (totalTickets == 0) return 0;

        // ✅ GET PLAYER POSITION
        IRaffleRead.ParticipantPosition memory pos = raffle.getParticipantPosition(seasonId, player);

        // ✅ CALCULATE PROBABILITY
        probabilityBps = (pos.ticketCount * 10000) / totalTickets;
    }

    /**
     * @notice Converts uint256 to string for error messages
     * @param value The uint256 value to convert
     * @return The string representation
     */
    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

interface IRaffleRead {
    enum SeasonStatus {
        NotStarted,
        Active,
        EndRequested,
        VRFPending,
        Distributing,
        Completed
    }

    struct ParticipantPosition {
        uint256 ticketCount;
        uint256 entryBlock;
        uint256 lastUpdateBlock;
        bool isActive;
    }

    function getSeasonDetails(uint256 seasonId)
        external
        view
        returns (
            RaffleTypes.SeasonConfig memory config,
            SeasonStatus status,
            uint256 totalParticipants,
            uint256 totalTickets,
            uint256 totalPrizePool
        );

    function getParticipantPosition(uint256 seasonId, address participant)
        external
        view
        returns (ParticipantPosition memory position);
}

interface IInfoFiPriceOracleMinimal {
    function updateRaffleProbability(uint256 marketId, uint256 raffleProbabilityBps) external;
    function updateMarketSentiment(uint256 marketId, uint256 marketSentimentBps) external;
}
