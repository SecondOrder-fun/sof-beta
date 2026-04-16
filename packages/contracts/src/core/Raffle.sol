// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {VRFConsumerBaseV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {IVRFCoordinatorV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {SOFBondingCurve, InvalidAddress, InvalidBondSteps} from "../curve/SOFBondingCurve.sol";
import {RaffleStorage} from "./RaffleStorage.sol";
import {RaffleLogic} from "../lib/RaffleLogic.sol";
import {ISeasonFactory} from "../lib/ISeasonFactory.sol";
import {RaffleTypes} from "../lib/RaffleTypes.sol";
import {IHats} from "../lib/IHats.sol";
import {IRafflePrizeDistributor} from "../lib/IRafflePrizeDistributor.sol";
import {TierConfigFailed} from "./RafflePrizeDistributor.sol";
import {ISeasonGating} from "../gating/ISeasonGating.sol";

// ============================================================================
// CUSTOM ERRORS - Clear, gas-efficient error reporting
// ============================================================================

error SeasonNotFound(uint256 seasonId);
error SeasonNotActive(uint256 seasonId);
error SeasonNotEnded(uint256 seasonId, uint256 currentTime, uint256 endTime);
error SeasonAlreadyStarted(uint256 seasonId);
error SeasonAlreadyEnded(uint256 seasonId);
error InvalidSeasonStatus(uint256 seasonId, uint8 currentStatus, uint8 expectedStatus);
error FactoryNotSet();
error DistributorNotSet();
error VRFRequestNotFound(uint256 requestId);
error NoWinnersSelected();
error InvalidWinnerCount(uint256 count);
error InvalidBasisPoints(uint256 bps);
error InvalidSeasonName();
error InvalidStartTime(uint256 startTime, uint256 currentTime);
error InvalidEndTime(uint256 endTime, uint256 startTime);
error InvalidTreasuryAddress();
error UnauthorizedCaller();
error NoVRFWords(uint256 seasonId);
error UserNotVerified(uint256 seasonId, address user);
error VRFTimeoutNotReached(uint256 seasonId, uint256 requestTime, uint256 timeoutAt);
error SeasonNotVRFPending(uint256 seasonId);
error SeasonFull(uint256 seasonId, uint32 maxParticipants);

/**
 * @title Raffle Contract
 * @notice Manages seasons, deploys per-season RaffleToken and SOFBondingCurve, integrates VRF v2.5.
 */
contract Raffle is RaffleStorage, AccessControl, ReentrancyGuard, VRFConsumerBaseV2Plus {
    using SafeERC20 for IERC20;

    // VRF v2.5
    IVRFCoordinatorV2Plus private COORDINATOR;
    bytes32 public vrfKeyHash;
    uint256 public vrfSubscriptionId;
    uint32 public vrfCallbackGasLimit = 200000;

    // Public getter for the VRF coordinator address
    function getCoordinatorAddress() external view returns (address) {
        return address(COORDINATOR);
    }

    uint16 public constant VRF_REQUEST_CONFIRMATIONS = 3;
    uint256 public constant VRF_TIMEOUT = 48 hours;
    uint16 public constant MAX_WINNER_COUNT = 10;
    uint32 public defaultMaxParticipants = 10000;
    uint32 public constant ABSOLUTE_MAX_PARTICIPANTS = 50000;

    // Core
    IERC20 public immutable sofToken;
    ISeasonFactory public seasonFactory;
    // Prize Distributor integration
    address public prizeDistributor;
    // Default grand prize split in BPS (e.g., 6500 = 65%). If seasonConfig.grandPrizeBps == 0, use this default.
    uint16 public defaultGrandPrizeBps = 6500;

    // Hats Protocol integration for permissionless season creation
    IHats public hatsProtocol;
    uint256 public sponsorHatId;

    event SponsorHatUpdated(uint256 indexed oldHatId, uint256 indexed newHatId);
    event HatsProtocolUpdated(address indexed oldAddress, address indexed newAddress);

    /// @dev Emitted on every position change (buy/sell) with post-change totals
    /// @dev Backend listens to this event and triggers InfoFi market creation via Paymaster
    event PositionUpdate(
        uint256 indexed seasonId, address indexed player, uint256 oldTickets, uint256 newTickets, uint256 totalTickets
    );

    constructor(address _sofToken, address _vrfCoordinator, uint256 _vrfSubscriptionId, bytes32 _vrfKeyHash)
        VRFConsumerBaseV2Plus(_vrfCoordinator)
    {
        if (_sofToken == address(0)) revert InvalidAddress();
        sofToken = IERC20(_sofToken);
        COORDINATOR = IVRFCoordinatorV2Plus(_vrfCoordinator);
        vrfSubscriptionId = _vrfSubscriptionId;
        vrfKeyHash = _vrfKeyHash;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SEASON_CREATOR_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    function setSeasonFactory(address _seasonFactoryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_seasonFactoryAddress == address(0)) revert FactoryNotSet();
        seasonFactory = ISeasonFactory(_seasonFactoryAddress);
    }

    /**
     * @notice Set the raffle prize distributor contract
     */
    function setPrizeDistributor(address distributor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (distributor == address(0)) revert InvalidAddress();
        prizeDistributor = distributor;
    }

    /**
     * @notice Set the gating contract for participation requirements
     * @param _gatingContract The SeasonGating contract address
     */
    function setGatingContract(address _gatingContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldContract = gatingContract;
        gatingContract = _gatingContract;
        emit GatingContractUpdated(oldContract, _gatingContract);
    }

    /**
     * @notice Update the default grand prize split (in basis points)
     */
    function setDefaultGrandPrizeBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > 10000) revert InvalidBasisPoints(bps);
        defaultGrandPrizeBps = bps;
    }

    /**
     * @notice Set the Hats Protocol contract address
     * @param _hatsProtocol The Hats.sol contract address (or address(0) to disable)
     */
    function setHatsProtocol(address _hatsProtocol) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldAddress = address(hatsProtocol);
        hatsProtocol = IHats(_hatsProtocol);
        emit HatsProtocolUpdated(oldAddress, _hatsProtocol);
    }

    /**
     * @notice Set the Sponsor Hat ID for permissionless season creation
     * @param _hatId The hat ID that grants sponsor rights (or 0 to disable)
     */
    function setSponsorHat(uint256 _hatId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldHatId = sponsorHatId;
        sponsorHatId = _hatId;
        emit SponsorHatUpdated(oldHatId, _hatId);
    }

    /**
     * @notice Check if an address can create seasons (has Sponsor hat OR SEASON_CREATOR_ROLE)
     * @param account The address to check
     * @return bool True if the account can create seasons
     */
    function canCreateSeason(address account) public view returns (bool) {
        // Check role-based access first
        if (hasRole(SEASON_CREATOR_ROLE, account)) {
            return true;
        }

        // Check hat-based access if Hats is configured
        if (address(hatsProtocol) != address(0) && sponsorHatId != 0) {
            return hatsProtocol.isWearerOfHat(account, sponsorHatId)
                && hatsProtocol.isInGoodStanding(account, sponsorHatId);
        }

        return false;
    }

    /**
     * @notice Create a new season: deploy RaffleToken and SOFBondingCurve, grant roles, init curve.
     */
    function createSeason(
        RaffleTypes.SeasonConfig memory config,
        RaffleTypes.BondStep[] memory bondSteps,
        uint16 buyFeeBps,
        uint16 sellFeeBps
    ) external nonReentrant returns (uint256 seasonId) {
        return _createSeasonInternal(config, bondSteps, buyFeeBps, sellFeeBps, new IRafflePrizeDistributor.TierConfig[](0));
    }

    function createSeasonWithTiers(
        RaffleTypes.SeasonConfig memory config,
        RaffleTypes.BondStep[] memory bondSteps,
        uint16 buyFeeBps,
        uint16 sellFeeBps,
        IRafflePrizeDistributor.TierConfig[] memory tierConfigs
    ) external nonReentrant returns (uint256 seasonId) {
        return _createSeasonInternal(config, bondSteps, buyFeeBps, sellFeeBps, tierConfigs);
    }

    function _createSeasonInternal(
        RaffleTypes.SeasonConfig memory config,
        RaffleTypes.BondStep[] memory bondSteps,
        uint16 buyFeeBps,
        uint16 sellFeeBps,
        IRafflePrizeDistributor.TierConfig[] memory tierConfigs
    ) internal returns (uint256 seasonId) {
        // Check authorization: must have SEASON_CREATOR_ROLE or valid Sponsor hat
        if (!canCreateSeason(msg.sender)) revert UnauthorizedCaller();

        if (address(seasonFactory) == address(0)) revert FactoryNotSet();
        if (bytes(config.name).length == 0) revert InvalidSeasonName();
        if (config.startTime <= block.timestamp) revert InvalidStartTime(config.startTime, block.timestamp);
        if (config.endTime <= config.startTime) revert InvalidEndTime(config.endTime, config.startTime);
        if (config.grandPrizeBps > 10000) revert InvalidBasisPoints(config.grandPrizeBps);
        if (config.treasuryAddress == address(0)) revert InvalidTreasuryAddress();
        if (bondSteps.length == 0) revert InvalidBondSteps();

        // Derive winnerCount from tier config if provided
        if (tierConfigs.length > 0) {
            uint16 totalWinners = 0;
            for (uint256 i = 0; i < tierConfigs.length; i++) {
                totalWinners += tierConfigs[i].winnerCount;
            }
            config.winnerCount = totalWinners;
        }

        if (config.winnerCount == 0) revert InvalidWinnerCount(0);
        if (config.winnerCount > MAX_WINNER_COUNT) revert InvalidWinnerCount(config.winnerCount);

        if (config.maxParticipants == 0) {
            config.maxParticipants = defaultMaxParticipants;
        }
        if (config.maxParticipants > ABSOLUTE_MAX_PARTICIPANTS) {
            config.maxParticipants = ABSOLUTE_MAX_PARTICIPANTS;
        }

        seasonId = ++currentSeasonId;

        (address raffleTokenAddr, address curveAddr) =
            seasonFactory.createSeasonContracts(seasonId, config, bondSteps, buyFeeBps, sellFeeBps);

        // Persist config - set sponsor to caller
        config.raffleToken = raffleTokenAddr;
        config.bondingCurve = curveAddr;
        config.sponsor = msg.sender;
        config.isActive = false;
        config.isCompleted = false;
        seasons[seasonId] = config;
        seasonStates[seasonId].status = SeasonStatus.NotStarted;

        // Allow the curve to call participant hooks
        _grantRole(BONDING_CURVE_ROLE, curveAddr);

        // Configure tiers on the prize distributor if provided
        if (tierConfigs.length > 0 && prizeDistributor != address(0)) {
            // Convert memory array to calldata-compatible format via external call
            IRafflePrizeDistributor.TierConfig[] memory configs = tierConfigs;
            _configureTiersOnDistributor(seasonId, configs);
        }

        emit SeasonCreated(seasonId, config.name, config.startTime, config.endTime, raffleTokenAddr, curveAddr);
    }

    function _configureTiersOnDistributor(uint256 seasonId, IRafflePrizeDistributor.TierConfig[] memory configs) internal {
        // We need to use a low-level call since configureTiers expects calldata
        bytes memory data = abi.encodeWithSelector(
            IRafflePrizeDistributor.configureTiers.selector,
            seasonId,
            configs
        );
        (bool success, bytes memory returnData) = prizeDistributor.call(data);
        if (!success) {
            // Bubble up the revert reason from the distributor
            if (returnData.length > 0) {
                assembly { revert(add(returnData, 32), mload(returnData)) }
            }
            revert TierConfigFailed();
        }
    }

    function startSeason(uint256 seasonId) external {
        // Check authorization: must have SEASON_CREATOR_ROLE or valid Sponsor hat
        if (!canCreateSeason(msg.sender)) revert UnauthorizedCaller();
        if (seasonId == 0 || seasonId > currentSeasonId) revert SeasonNotFound(seasonId);
        if (seasons[seasonId].isActive) revert SeasonAlreadyStarted(seasonId);
        if (block.timestamp < seasons[seasonId].startTime) {
            revert SeasonNotEnded(seasonId, block.timestamp, seasons[seasonId].startTime);
        }
        if (block.timestamp >= seasons[seasonId].endTime) revert SeasonAlreadyEnded(seasonId);
        if (seasonStates[seasonId].status != SeasonStatus.NotStarted) {
            revert InvalidSeasonStatus(seasonId, uint8(seasonStates[seasonId].status), uint8(SeasonStatus.NotStarted));
        }

        // Hat wearers (non-role holders) can only start their own seasons
        if (!hasRole(SEASON_CREATOR_ROLE, msg.sender)) {
            if (seasons[seasonId].sponsor != msg.sender) revert UnauthorizedCaller();
        }

        seasons[seasonId].isActive = true;
        seasonStates[seasonId].status = SeasonStatus.Active;
        emit SeasonStarted(seasonId);
    }

    function requestSeasonEnd(uint256 seasonId) external onlyRole(SEASON_CREATOR_ROLE) {
        if (seasonId == 0 || seasonId > currentSeasonId) revert SeasonNotFound(seasonId);
        if (!seasons[seasonId].isActive) revert SeasonNotActive(seasonId);
        if (block.timestamp < seasons[seasonId].endTime) {
            revert SeasonNotEnded(seasonId, block.timestamp, seasons[seasonId].endTime);
        }
        if (seasonStates[seasonId].status != SeasonStatus.Active) {
            revert InvalidSeasonStatus(seasonId, uint8(seasonStates[seasonId].status), uint8(SeasonStatus.Active));
        }

        // Lock trading on curve
        SOFBondingCurve curve = SOFBondingCurve(seasons[seasonId].bondingCurve);
        curve.lockTrading();
        seasonStates[seasonId].totalPrizePool = curve.getSofReserves();
        seasons[seasonId].isActive = false;
        seasonStates[seasonId].status = SeasonStatus.EndRequested;
        emit SeasonLocked(seasonId);

        // Capture audit snapshot of participant state at lock time
        _snapshotParticipants(seasonId);

        // VRF v2.5 request for winner selection (numWords == winnerCount)
        uint256 requestId = COORDINATOR.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: VRF_REQUEST_CONFIRMATIONS,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: seasons[seasonId].winnerCount,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        seasonStates[seasonId].vrfRequestId = requestId;
        seasonStates[seasonId].vrfRequestTimestamp = block.timestamp;
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
        emit SeasonEndRequested(seasonId, requestId);
    }

    /**
     * @notice Emergency-only early end. Skips endTime check but requires Active status.
     * @dev Locks trading, marks EndRequested -> VRFPending, and triggers VRF like normal end.
     */
    function requestSeasonEndEarly(uint256 seasonId) external onlyRole(EMERGENCY_ROLE) {
        if (seasonId == 0 || seasonId > currentSeasonId) revert SeasonNotFound(seasonId);
        if (!seasons[seasonId].isActive) revert SeasonNotActive(seasonId);
        if (seasonStates[seasonId].status != SeasonStatus.Active) {
            revert InvalidSeasonStatus(seasonId, uint8(seasonStates[seasonId].status), uint8(SeasonStatus.Active));
        }

        // Lock trading on curve
        SOFBondingCurve curve = SOFBondingCurve(seasons[seasonId].bondingCurve);
        curve.lockTrading();
        seasonStates[seasonId].totalPrizePool = curve.getSofReserves();
        seasons[seasonId].isActive = false;
        seasonStates[seasonId].status = SeasonStatus.EndRequested;
        emit SeasonLocked(seasonId);

        // Capture audit snapshot of participant state at lock time
        _snapshotParticipants(seasonId);

        // VRF v2.5 request for winner selection (numWords == winnerCount)
        uint256 requestId = COORDINATOR.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: VRF_REQUEST_CONFIRMATIONS,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: seasons[seasonId].winnerCount,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        seasonStates[seasonId].vrfRequestId = requestId;
        seasonStates[seasonId].vrfRequestTimestamp = block.timestamp;
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
        emit SeasonEndRequested(seasonId, requestId);
    }

    /**
     * @notice Cancel a season stuck in VRFPending after the timeout period.
     * @dev Unlocks the bonding curve in sell-only mode so users can exit.
     *      No re-request of VRF is allowed — this prevents re-roll attacks.
     *      If VRF arrives late after cancellation, fulfillRandomWords ignores it silently.
     * @param seasonId The season to cancel
     */
    function cancelStuckSeason(uint256 seasonId) external onlyRole(EMERGENCY_ROLE) nonReentrant {
        if (seasonId == 0 || seasonId > currentSeasonId) revert SeasonNotFound(seasonId);
        SeasonState storage state = seasonStates[seasonId];
        if (state.status != SeasonStatus.VRFPending) revert SeasonNotVRFPending(seasonId);

        uint256 timeoutAt = state.vrfRequestTimestamp + VRF_TIMEOUT;
        if (block.timestamp < timeoutAt) {
            revert VRFTimeoutNotReached(seasonId, state.vrfRequestTimestamp, timeoutAt);
        }

        // Unlock curve in sell-only mode so users can exit
        SOFBondingCurve curve = SOFBondingCurve(seasons[seasonId].bondingCurve);
        curve.unlockTradingSellOnly();

        state.status = SeasonStatus.Cancelled;
        emit SeasonCancelled(seasonId);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        uint256 seasonId = vrfRequestToSeason[requestId];
        if (seasonId == 0) revert VRFRequestNotFound(requestId);

        // Late VRF arrival for a cancelled season — ignore silently to avoid wasting VRF node gas
        if (seasonStates[seasonId].status == SeasonStatus.Cancelled) {
            return;
        }

        if (seasonStates[seasonId].status != SeasonStatus.VRFPending) {
            revert InvalidSeasonStatus(seasonId, uint8(seasonStates[seasonId].status), uint8(SeasonStatus.VRFPending));
        }

        SeasonState storage state = seasonStates[seasonId];
        delete state.vrfRandomWords;
        for (uint256 i = 0; i < randomWords.length; i++) {
            state.vrfRandomWords.push(randomWords[i]);
        }

        state.status = SeasonStatus.Distributing;
        emit VRFFulfilled(seasonId, requestId);
        emit SeasonReadyToFinalize(seasonId);
    }

    /// @notice Internal finalization logic - selects winners, configures distributor, funds prizes
    /// @param seasonId The season to finalize
    function _executeFinalization(uint256 seasonId) internal {
        SeasonState storage state = seasonStates[seasonId];
        RaffleTypes.SeasonConfig storage cfg = seasons[seasonId];

        uint256 totalPrizePool = state.totalPrizePool;

        address[] memory winners = RaffleLogic._selectWinnersAddressBased(
            state,
            cfg.winnerCount,
            state.vrfRandomWords
        );
        state.winners = winners;

        emit WinnersSelected(seasonId, winners);

        // Compute pool splits
        if (prizeDistributor == address(0)) revert DistributorNotSet();

        // If there are no participants or no winners, we can still complete the
        // season but skip prize distribution logic that assumes a non-zero winner.
        if (state.totalParticipants == 0 || winners.length == 0 || totalPrizePool == 0) {
            cfg.isCompleted = true;
            state.status = SeasonStatus.Completed;
            emit PrizeDistributionSetup(seasonId, prizeDistributor);
            emit SeasonCompleted(seasonId);
            return;
        }

        uint256 totalParticipants = state.totalParticipants;

        uint16 grandBps = cfg.grandPrizeBps == 0 ? defaultGrandPrizeBps : cfg.grandPrizeBps;
        if (grandBps > 10000) revert InvalidBasisPoints(grandBps);
        uint256 grandAmount = (totalPrizePool * uint256(grandBps)) / 10000;
        uint256 consolationAmount = totalPrizePool - grandAmount;

        // Single participant gets the entire pool — no consolation recipients exist
        if (totalParticipants == 1) {
            grandAmount = totalPrizePool;
            consolationAmount = 0;
        }

        address grandWinner = winners.length > 0 ? winners[0] : address(0);
        if (grandWinner == address(0)) revert NoWinnersSelected();

        address curveAddr = cfg.bondingCurve;
        if (curveAddr == address(0)) revert InvalidAddress();

        IRafflePrizeDistributor(prizeDistributor).configureSeason(
            seasonId,
            address(sofToken),
            grandWinner,
            grandAmount,
            consolationAmount,
            totalParticipants
        );

        SOFBondingCurve(curveAddr).extractSof(prizeDistributor, totalPrizePool);

        IRafflePrizeDistributor(prizeDistributor).fundSeason(seasonId, totalPrizePool);

        // Map winners to tiers and lock sponsorships
        _finalizeTiersAndSponsorships(seasonId, winners);

        cfg.isCompleted = true;
        state.status = SeasonStatus.Completed;
        emit PrizeDistributionSetup(seasonId, prizeDistributor);
        emit SeasonCompleted(seasonId);
    }

    function _finalizeTiersAndSponsorships(uint256 seasonId, address[] memory winners) internal {
        // Set tier winners if tiers are configured
        IRafflePrizeDistributor.TierConfig[] memory tiers = IRafflePrizeDistributor(prizeDistributor).getTierConfigs(seasonId);
        if (tiers.length > 0 && winners.length > 0) {
            // Use low-level call for calldata encoding
            bytes memory data = abi.encodeWithSelector(
                IRafflePrizeDistributor.setTierWinners.selector,
                seasonId,
                winners
            );
            (bool success, bytes memory returnData) = prizeDistributor.call(data);
            if (!success) {
                if (returnData.length > 0) {
                    assembly { revert(add(returnData, 32), mload(returnData)) }
                }
                revert TierConfigFailed();
            }
        }

        // Lock sponsorships (non-fatal if already locked)
        try IRafflePrizeDistributor(prizeDistributor).lockSponsorships(seasonId) {} catch {}
    }

    /// @notice Compute and store a keccak256 hash of participant addresses and ticket counts
    /// @dev Called at season lock time to create an immutable audit trail
    function _snapshotParticipants(uint256 seasonId) internal {
        SeasonState storage state = seasonStates[seasonId];
        address[] memory participants = state.participants;
        uint256[] memory ticketCounts = new uint256[](participants.length);
        for (uint256 i = 0; i < participants.length; i++) {
            ticketCounts[i] = state.participantPositions[participants[i]].ticketCount;
        }
        bytes32 snapshotHash = keccak256(abi.encode(participants, ticketCounts));
        state.lockSnapshot = snapshotHash;
        emit SeasonSnapshotted(seasonId, snapshotHash);
    }

    /// @notice Get the audit snapshot hash stored at season lock time
    function getSeasonSnapshot(uint256 seasonId) external view returns (bytes32) {
        return seasonStates[seasonId].lockSnapshot;
    }

    // Called by curve
    function recordParticipant(uint256 seasonId, address participant, uint256 ticketAmount)
        external
        onlyRole(BONDING_CURVE_ROLE)
    {
        require(seasons[seasonId].isActive, "Raffle: season inactive");

        // Check gating requirements if season is gated
        if (seasons[seasonId].gated && gatingContract != address(0)) {
            if (!ISeasonGating(gatingContract).isUserVerified(seasonId, participant)) {
                revert UserNotVerified(seasonId, participant);
            }
        }

        SeasonState storage state = seasonStates[seasonId];
        ParticipantPosition storage pos = state.participantPositions[participant];
        uint256 oldTickets = pos.ticketCount;
        uint256 newTicketsLocal = oldTickets + ticketAmount;
        uint256 newTotalTickets = state.totalTickets + ticketAmount;

        // Update state
        if (!pos.isActive) {
            uint32 maxP = seasons[seasonId].maxParticipants;
            if (maxP > 0 && state.totalParticipants >= maxP) {
                revert SeasonFull(seasonId, maxP);
            }
            state.participants.push(participant);
            state.totalParticipants++;
            pos.entryBlock = block.number;
            pos.isActive = true;
            emit ParticipantAdded(seasonId, participant, ticketAmount, newTotalTickets);
        } else {
            emit ParticipantUpdated(seasonId, participant, newTicketsLocal, newTotalTickets);
        }
        pos.ticketCount = newTicketsLocal;
        pos.lastUpdateBlock = block.number;
        state.totalTickets = newTotalTickets;

        // Emit position update for backend listeners
        // Backend will listen to this event and trigger InfoFi market creation via Paymaster
        emit PositionUpdate(seasonId, participant, oldTickets, newTicketsLocal, state.totalTickets);
    }

    function removeParticipant(uint256 seasonId, address participant, uint256 ticketAmount)
        external
        onlyRole(BONDING_CURVE_ROLE)
    {
        require(
            seasons[seasonId].isActive || seasonStates[seasonId].status == SeasonStatus.Cancelled,
            "Raffle: season inactive"
        );
        SeasonState storage state = seasonStates[seasonId];
        ParticipantPosition storage pos = state.participantPositions[participant];
        require(pos.isActive, "Raffle: not active");
        require(pos.ticketCount >= ticketAmount, "Raffle: too much");

        // Calculate new values before state updates
        uint256 oldTickets = pos.ticketCount;
        uint256 newTickets = oldTickets - ticketAmount;
        uint256 newTotalTickets = state.totalTickets - ticketAmount;

        // Update state
        pos.ticketCount = newTickets;
        pos.lastUpdateBlock = block.number;
        state.totalTickets = newTotalTickets;

        if (newTickets == 0) {
            pos.isActive = false;
            state.totalParticipants--;
            // remove from array (swap and pop)
            for (uint256 i = 0; i < state.participants.length; i++) {
                if (state.participants[i] == participant) {
                    state.participants[i] = state.participants[state.participants.length - 1];
                    state.participants.pop();
                    break;
                }
            }
        }
        emit ParticipantRemoved(seasonId, participant, newTotalTickets);

        // Emit InfoFi position update for backend listeners
        emit PositionUpdate(seasonId, participant, oldTickets, newTickets, newTotalTickets);
    }

    // Views
    function getParticipants(uint256 seasonId) external view returns (address[] memory) {
        return seasonStates[seasonId].participants;
    }

    function getParticipantPosition(uint256 seasonId, address participant)
        external
        view
        returns (ParticipantPosition memory position)
    {
        return seasonStates[seasonId].participantPositions[participant];
    }

    function getParticipantNumberRange(uint256 seasonId, address participant)
        external
        view
        returns (uint256 start, uint256 end)
    {
        SeasonState storage state = seasonStates[seasonId];
        ParticipantPosition storage p = state.participantPositions[participant];
        if (!p.isActive) return (0, 0);
        uint256 cur = 1;
        for (uint256 i = 0; i < state.participants.length; i++) {
            address addr = state.participants[i];
            ParticipantPosition storage pos = state.participantPositions[addr];
            if (addr == participant) return (cur, cur + pos.ticketCount - 1);
            cur += pos.ticketCount;
        }
        return (0, 0);
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
        )
    {
        config = seasons[seasonId];
        SeasonState storage state = seasonStates[seasonId];
        status = state.status;
        totalParticipants = state.totalParticipants;
        totalTickets = state.totalTickets;
        totalPrizePool = state.totalPrizePool;
    }

    function getWinners(uint256 seasonId) external view returns (address[] memory) {
        require(seasonStates[seasonId].status == SeasonStatus.Completed, "Raffle: not completed");
        return seasonStates[seasonId].winners;
    }

    /**
     * @notice Get the current active season ID
     * @return uint256 The current active season ID or 0 if no active season
     */
    function getCurrentSeason() external view returns (uint256) {
        for (uint256 i = currentSeasonId; i > 0; i--) {
            if (seasons[i].isActive) {
                return i;
            }
        }
        return 0; // No active season
    }

    /**
     * @notice Check if a season is active
     * @param seasonId The season ID to check
     * @return bool True if the season is active
     */
    function isSeasonActive(uint256 seasonId) external view returns (bool) {
        return seasons[seasonId].isActive;
    }

    /**
     * @notice Get the total tickets for a season
     * @param seasonId The season ID
     * @return uint256 The total tickets
     */
    function getTotalTickets(uint256 seasonId) external view returns (uint256) {
        return seasonStates[seasonId].totalTickets;
    }

    /**
     * @notice Get the player list for a season
     * @param seasonId The season ID
     * @return address[] The list of players
     */
    function getPlayerList(uint256 seasonId) external view returns (address[] memory) {
        return seasonStates[seasonId].participants;
    }

    /**
     * @notice Get the number range for a player in a season
     * @param seasonId The season ID
     * @param player The player address
     * @return startRange The start of the player's number range
     * @return endRange The end of the player's number range
     */
    function getNumberRange(uint256 seasonId, address player)
        external
        view
        returns (uint256 startRange, uint256 endRange)
    {
        // Calculate the player's number range based on their position in the participants array
        uint256 rangeStart = 0;
        address[] memory participants = seasonStates[seasonId].participants;

        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i] == player) {
                break;
            }
            ParticipantPosition memory prevPos = seasonStates[seasonId].participantPositions[participants[i]];
            rangeStart += prevPos.ticketCount;
        }

        ParticipantPosition memory pos = seasonStates[seasonId].participantPositions[player];
        startRange = rangeStart;
        endRange = rangeStart + pos.ticketCount;
        return (startRange, endRange);
    }

    /**
     * @notice Get the season winner
     * @param seasonId The season ID
     * @return address The winner address or address(0) if not determined yet
     */
    function getSeasonWinner(uint256 seasonId) external view returns (address) {
        if (seasonStates[seasonId].winners.length > 0) {
            return seasonStates[seasonId].winners[0];
        }
        return address(0);
    }

    /**
     * @notice Get the final player position after season completion
     * @param seasonId The season ID
     * @param player The player address
     * @return uint256 The final ticket count
     */
    function getFinalPlayerPosition(uint256 seasonId, address player) external view returns (uint256) {
        require(seasons[seasonId].isCompleted, "Raffle: season not completed");
        return seasonStates[seasonId].participantPositions[player].ticketCount;
    }

    function getVrfRequestForSeason(uint256 seasonId) external view returns (uint256) {
        require(seasonId != 0 && seasonId <= currentSeasonId, "Raffle: no season");
        return seasonStates[seasonId].vrfRequestId;
    }

    // Admin
    function pauseSeason(uint256 seasonId) external onlyRole(EMERGENCY_ROLE) {
        require(seasonId != 0 && seasonId <= currentSeasonId, "Raffle: no season");
        seasons[seasonId].isActive = false;
    }

    function updateVRFConfig(uint256 _subscriptionId, bytes32 _keyHash, uint32 _callbackGasLimit)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        vrfSubscriptionId = _subscriptionId;
        vrfKeyHash = _keyHash;
        vrfCallbackGasLimit = _callbackGasLimit;
    }

    /**
     * @notice Update the VRF Coordinator address (both the local COORDINATOR and inherited s_vrfCoordinator)
     * @dev Needed when the coordinator address was set incorrectly at deployment or after migration.
     *      Updates COORDINATOR (used for outgoing requestRandomWords calls) and
     *      s_vrfCoordinator (used by VRFConsumerBaseV2Plus.rawFulfillRandomWords for callback validation).
     * @param _vrfCoordinator The new VRF Coordinator address
     */
    function setVRFCoordinator(address _vrfCoordinator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_vrfCoordinator == address(0)) revert InvalidAddress();
        COORDINATOR = IVRFCoordinatorV2Plus(_vrfCoordinator);
        s_vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
    }

    /**
     * @notice Manually complete a season that is stuck in Distributing state
     * @dev Only for emergency use when automatic completion fails
     */
    function completeSeasonManually(uint256 seasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(seasonId != 0 && seasonId <= currentSeasonId, "Raffle: no season");
        require(seasonStates[seasonId].status == SeasonStatus.Distributing, "Raffle: not distributing");

        SeasonState storage state = seasonStates[seasonId];
        // Only allow manual completion if prizes were already distributed (winners selected)
        // or there are no participants to pay out
        require(
            state.winners.length > 0 || state.totalParticipants == 0,
            "Raffle: prizes not distributed"
        );

        // Mark complete
        seasons[seasonId].isCompleted = true;
        state.status = SeasonStatus.Completed;
        emit SeasonCompleted(seasonId);
    }

    /**
     * @notice Manually trigger prize distribution setup for a season that is stuck in Distributing state
     * @dev Only for emergency use when automatic prize distribution setup fails
     */
    function setupPrizeDistributionManually(uint256 seasonId) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        require(seasonId != 0 && seasonId <= currentSeasonId, "Raffle: no season");
        require(seasonStates[seasonId].status == SeasonStatus.Distributing, "Raffle: not distributing");

        // Deprecated: manual setup flow has been replaced by finalizeSeason
        revert("Raffle: use finalizeSeason");
    }

    /// @notice Manual fallback to finalize a season if auto-finalization failed
    /// @param seasonId The season to finalize
    /// @dev Can be called by anyone when season is in Distributing status with VRF words
    function finalizeSeason(uint256 seasonId) external nonReentrant {
        if (seasonId == 0 || seasonId > currentSeasonId) revert SeasonNotFound(seasonId);
        SeasonState storage state = seasonStates[seasonId];
        if (state.status != SeasonStatus.Distributing) {
            revert InvalidSeasonStatus(seasonId, uint8(state.status), uint8(SeasonStatus.Distributing));
        }
        if (state.vrfRandomWords.length == 0) revert NoVRFWords(seasonId);

        _executeFinalization(seasonId);
    }

    // Merkle root function removed - consolation now uses direct claim

    function fundPrizeDistributor(uint256 seasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(prizeDistributor != address(0), "Raffle: distributor not set");
        SeasonState storage state = seasonStates[seasonId];
        uint256 totalPrizePool = state.totalPrizePool;
        IRafflePrizeDistributor(prizeDistributor).fundSeason(seasonId, totalPrizePool);
    }
}
