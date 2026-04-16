// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRolloverEscrow} from "./IRolloverEscrow.sol";
import {SOFBondingCurve} from "../curve/SOFBondingCurve.sol";

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

error PhaseNotOpen(uint256 seasonId);
error PhaseNotActive(uint256 seasonId);
error PhaseNotActiveOrClosedOrExpired(uint256 seasonId);
error InvalidPhaseTransition(uint256 seasonId, RolloverEscrow.EscrowPhase current, RolloverEscrow.EscrowPhase target);
error AmountZero();
error ExceedsBalance(uint256 requested, uint256 available);
error AlreadyRefunded(uint256 seasonId, address user);
error NothingToRefund(uint256 seasonId, address user);
error BondingCurveNotSet();

/**
 * @title RolloverEscrow
 * @notice Holds rolled-over consolation SOF for a season cohort, tracks per-user
 *         positions, and manages phase transitions (Open → Active → Closed/Expired).
 *         Spend (Task 4) and Refund (Task 5) functions are left as stubs.
 */
contract RolloverEscrow is IRolloverEscrow, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Roles
    // -----------------------------------------------------------------------

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // -----------------------------------------------------------------------
    // Enums
    // -----------------------------------------------------------------------

    enum EscrowPhase {
        None,
        Open,
        Active,
        Closed,
        Expired
    }

    // -----------------------------------------------------------------------
    // Structs
    // -----------------------------------------------------------------------

    struct CohortState {
        EscrowPhase phase;
        uint256 nextSeasonId;
        uint16 bonusBps;
        uint256 totalDeposited;
        uint256 totalSpent;
        uint256 totalBonusPaid;
        uint40 openedAt;
    }

    struct UserPosition {
        uint256 deposited;
        uint256 spent;
        bool refunded;
    }

    // -----------------------------------------------------------------------
    // Immutables & Config
    // -----------------------------------------------------------------------

    IERC20 public immutable sofToken;

    address public treasury;
    address public raffle;
    uint16 public defaultBonusBps;
    uint32 public expiryTimeout;
    address public bondingCurve;

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    mapping(uint256 => CohortState) internal _cohorts;
    mapping(uint256 => mapping(address => UserPosition)) internal _positions;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event RolloverDeposit(address indexed user, uint256 indexed seasonId, uint256 amount);
    event RolloverSpend(
        address indexed user,
        uint256 indexed seasonId,
        uint256 indexed nextSeasonId,
        uint256 baseAmount,
        uint256 bonusAmount
    );
    event RolloverRefund(address indexed user, uint256 indexed seasonId, uint256 amount);
    event CohortOpened(uint256 indexed seasonId, uint16 bonusBps);
    event CohortActivated(uint256 indexed seasonId, uint256 indexed nextSeasonId);
    event CohortClosed(uint256 indexed seasonId);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address _sofToken, address _treasury, address _raffle) {
        sofToken = IERC20(_sofToken);
        treasury = _treasury;
        raffle = _raffle;
        defaultBonusBps = 600; // 6%
        expiryTimeout = 30 days;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier whenPhaseOpen(uint256 seasonId) {
        _checkAndUpdateExpiry(seasonId);
        if (_cohorts[seasonId].phase != EscrowPhase.Open) {
            revert PhaseNotOpen(seasonId);
        }
        _;
    }

    modifier whenPhaseActive(uint256 seasonId) {
        if (_cohorts[seasonId].phase != EscrowPhase.Active) {
            revert PhaseNotActive(seasonId);
        }
        _;
    }

    modifier whenPhaseRefundable(uint256 seasonId) {
        _checkAndUpdateExpiry(seasonId);
        EscrowPhase phase = _cohorts[seasonId].phase;
        if (
            phase != EscrowPhase.Active
                && phase != EscrowPhase.Closed
                && phase != EscrowPhase.Expired
        ) {
            revert PhaseNotActiveOrClosedOrExpired(seasonId);
        }
        _;
    }

    // -----------------------------------------------------------------------
    // External: Deposit
    // -----------------------------------------------------------------------

    /**
     * @notice Record a rollover deposit on behalf of a user.
     * @dev Called by the PrizeDistributor (DISTRIBUTOR_ROLE) when a user opts
     *      to roll their consolation prize into the next season.
     *      Tokens are transferred from msg.sender to this contract.
     * @param user     The beneficiary whose position is credited.
     * @param amount   Amount of sofToken to deposit.
     * @param seasonId The season cohort to deposit into.
     */
    function deposit(address user, uint256 amount, uint256 seasonId)
        external
        override
        onlyRole(DISTRIBUTOR_ROLE)
        whenNotPaused
        whenPhaseOpen(seasonId)
        nonReentrant
    {
        if (amount == 0) revert AmountZero();

        _positions[seasonId][user].deposited += amount;
        _cohorts[seasonId].totalDeposited += amount;

        sofToken.safeTransferFrom(msg.sender, address(this), amount);

        emit RolloverDeposit(user, seasonId, amount);
    }

    // -----------------------------------------------------------------------
    // External: Phase Transitions (admin)
    // -----------------------------------------------------------------------

    /**
     * @notice Open a new cohort for deposits.
     * @param seasonId  The season identifier.
     * @param bonusBps  Bonus in basis points (0 = use defaultBonusBps).
     */
    function openCohort(uint256 seasonId, uint16 bonusBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CohortState storage cohort = _cohorts[seasonId];
        if (cohort.phase != EscrowPhase.None) {
            revert InvalidPhaseTransition(seasonId, cohort.phase, EscrowPhase.Open);
        }

        uint16 bps = bonusBps == 0 ? defaultBonusBps : bonusBps;
        cohort.phase = EscrowPhase.Open;
        cohort.bonusBps = bps;
        cohort.openedAt = uint40(block.timestamp);

        emit CohortOpened(seasonId, bps);
    }

    /**
     * @notice Transition a cohort from Open to Active (deposits locked, spend enabled).
     * @param seasonId     The season cohort.
     * @param nextSeasonId The next season tickets will be purchased for.
     */
    function activateCohort(uint256 seasonId, uint256 nextSeasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkAndUpdateExpiry(seasonId);

        CohortState storage cohort = _cohorts[seasonId];
        if (cohort.phase != EscrowPhase.Open) {
            revert InvalidPhaseTransition(seasonId, cohort.phase, EscrowPhase.Active);
        }

        cohort.phase = EscrowPhase.Active;
        cohort.nextSeasonId = nextSeasonId;

        emit CohortActivated(seasonId, nextSeasonId);
    }

    /**
     * @notice Transition a cohort from Active to Closed.
     * @param seasonId The season cohort.
     */
    function closeCohort(uint256 seasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CohortState storage cohort = _cohorts[seasonId];
        if (cohort.phase != EscrowPhase.Active) {
            revert PhaseNotActive(seasonId);
        }

        cohort.phase = EscrowPhase.Closed;

        emit CohortClosed(seasonId);
    }

    // -----------------------------------------------------------------------
    // External: Admin Config
    // -----------------------------------------------------------------------

    function setDefaultBonusBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultBonusBps = newBps;
    }

    function setBondingCurve(address _curve) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bondingCurve = _curve;
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // -----------------------------------------------------------------------
    // External: Spend (Task 4)
    // -----------------------------------------------------------------------

    /**
     * @notice Spend rollover balance to buy tickets for the next season, with a bonus
     *         pulled from treasury.
     * @param seasonId     The rollover cohort season.
     * @param sofAmount    Amount of rollover SOF to spend (must not exceed available balance).
     * @param ticketAmount Number of raffle tickets to buy (pre-calculated by UI).
     * @param maxTotalSof  Slippage cap: maximum SOF (base + bonus) the curve may charge.
     */
    function spendFromRollover(uint256 seasonId, uint256 sofAmount, uint256 ticketAmount, uint256 maxTotalSof)
        external
        nonReentrant
        whenNotPaused
        whenPhaseActive(seasonId)
    {
        if (sofAmount == 0) revert AmountZero();
        if (bondingCurve == address(0)) revert BondingCurveNotSet();

        UserPosition storage pos = _positions[seasonId][msg.sender];
        uint256 available = pos.deposited - pos.spent;
        if (sofAmount > available) revert ExceedsBalance(sofAmount, available);

        CohortState storage cohort = _cohorts[seasonId];
        uint256 bonusAmount = (sofAmount * uint256(cohort.bonusBps)) / 10_000;

        // Checks-effects-interactions: update state before external calls
        pos.spent += sofAmount;
        cohort.totalSpent += sofAmount;
        cohort.totalBonusPaid += bonusAmount;

        // Pull bonus from treasury into this contract
        sofToken.safeTransferFrom(treasury, address(this), bonusAmount);

        // Approve curve for the total SOF (base + bonus)
        uint256 totalSof = sofAmount + bonusAmount;
        sofToken.approve(address(bondingCurve), totalSof);

        // Buy tickets for user via the bonding curve
        SOFBondingCurve(bondingCurve).buyTokensFor(msg.sender, ticketAmount, maxTotalSof);

        // Clear any leftover allowance (defense-in-depth)
        sofToken.approve(address(bondingCurve), 0);

        emit RolloverSpend(msg.sender, seasonId, cohort.nextSeasonId, sofAmount, bonusAmount);
    }

    // -----------------------------------------------------------------------
    // External: Refund (stub — Task 5)
    // -----------------------------------------------------------------------

    // TODO Task 5: implement refund
    // function refund(uint256 seasonId) external { ... }

    // -----------------------------------------------------------------------
    // View Functions
    // -----------------------------------------------------------------------

    /**
     * @notice Returns the user's position for a given season.
     */
    function getUserPosition(uint256 seasonId, address user)
        external
        view
        returns (uint256 deposited, uint256 spent, bool refunded)
    {
        UserPosition storage pos = _positions[seasonId][user];
        return (pos.deposited, pos.spent, pos.refunded);
    }

    /**
     * @notice Returns all cohort state fields plus a computed isExpired flag.
     */
    function getCohortState(uint256 seasonId)
        external
        view
        returns (
            EscrowPhase phase,
            uint256 nextSeasonId,
            uint16 bonusBps,
            uint256 totalDeposited,
            uint256 totalSpent,
            uint256 totalBonusPaid,
            bool isExpired
        )
    {
        CohortState storage cohort = _cohorts[seasonId];

        // Compute whether the cohort has expired (view-only, no state change)
        bool expired = cohort.phase == EscrowPhase.Open
            && cohort.openedAt > 0
            && block.timestamp > uint256(cohort.openedAt) + uint256(expiryTimeout);

        EscrowPhase effectivePhase = expired ? EscrowPhase.Expired : cohort.phase;

        return (
            effectivePhase,
            cohort.nextSeasonId,
            cohort.bonusBps,
            cohort.totalDeposited,
            cohort.totalSpent,
            cohort.totalBonusPaid,
            expired || cohort.phase == EscrowPhase.Expired
        );
    }

    /**
     * @notice Returns the user's available (unspent, non-refunded) balance.
     */
    function getAvailableBalance(uint256 seasonId, address user) external view returns (uint256) {
        UserPosition storage pos = _positions[seasonId][user];
        if (pos.refunded) return 0;
        uint256 deposited = pos.deposited;
        uint256 spent = pos.spent;
        return deposited > spent ? deposited - spent : 0;
    }

    /**
     * @notice Returns the bonus amount for a given base amount in a season.
     */
    function getBonusAmount(uint256 seasonId, uint256 amount) external view returns (uint256) {
        return (amount * uint256(_cohorts[seasonId].bonusBps)) / 10_000;
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /**
     * @dev Checks whether an Open cohort has exceeded its expiry timeout and, if so,
     *      auto-transitions it to Expired. Called at the start of state-changing
     *      operations on Open-phase cohorts.
     */
    function _checkAndUpdateExpiry(uint256 seasonId) internal {
        CohortState storage cohort = _cohorts[seasonId];
        if (
            cohort.phase == EscrowPhase.Open
                && cohort.openedAt > 0
                && block.timestamp > uint256(cohort.openedAt) + uint256(expiryTimeout)
        ) {
            cohort.phase = EscrowPhase.Expired;
        }
    }
}
