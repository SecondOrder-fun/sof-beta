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
error QuoteTokenNotSet(uint256 seasonId);
error QuoteTokenMismatch(uint256 seasonId, address expected, address actual);
error ExceedsBalance(uint256 requested, uint256 available);
error AlreadyRefunded(uint256 seasonId, address user);
error NothingToRefund(uint256 seasonId, address user);
error BondingCurveNotSet();

/**
 * @title RolloverEscrow
 * @notice Holds rolled-over consolation payouts for a season cohort, denominated in
 *         that season's quote token, and tracks per-user
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
        // Set at activation; locks spendFromRollover to the curve that matches
        // nextSeasonId. Removes the global mutable bondingCurve slot that
        // could drift between cohorts.
        address bondingCurve;
        // The ERC-20 this cohort holds, captured at openCohort from the
        // completing season's quoteToken. Deposits arrive in that token (the
        // distributor forwards the season's prize asset), so it is fixed before
        // any curve is known and must not be re-derived later.
        address token;
    }

    struct UserPosition {
        uint256 deposited;
        uint256 spent;
        bool refunded;
    }

    // -----------------------------------------------------------------------
    // Immutables & Config
    // -----------------------------------------------------------------------

    address public treasury;
    address public raffle;
    uint16 public defaultBonusBps;
    uint32 public expiryTimeout;

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
    event CohortOpened(uint256 indexed seasonId, uint16 bonusBps, address indexed token);
    event CohortActivated(uint256 indexed seasonId, uint256 indexed nextSeasonId, address indexed bondingCurve);
    event CohortClosed(uint256 indexed seasonId);
    event DefaultBonusBpsUpdated(uint16 oldBps, uint16 newBps);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    /// @notice A spend went ahead without its bonus because the treasury could not fund it
    ///         in the cohort's token (balance or allowance short).
    event BonusUnfunded(address indexed user, uint256 indexed seasonId, uint256 bonusWanted);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @dev No token is configured here. Each cohort captures its own at openCohort
    ///      from the season's quoteToken, because different seasons are priced in
    ///      different tokens.
    constructor(address _treasury, address _raffle) {
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
     * @param amount   Amount of the cohort's quote token to deposit.
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

        // Tokens must already be in this contract before calling deposit().
        // The PrizeDistributor transfers the season's prize asset to escrow via safeTransfer,
        // then calls deposit() for accounting only.

        emit RolloverDeposit(user, seasonId, amount);
    }

    // -----------------------------------------------------------------------
    // External: Phase Transitions (admin)
    // -----------------------------------------------------------------------

    /**
     * @notice Open a new cohort for deposits.
     * @dev The caller supplies the cohort's token, and open is the only correct moment
     *      to fix it: consolation deposits for this cohort arrive in THIS season's prize
     *      asset, whereas activateCohort later binds the NEXT season's curve, which may
     *      quote a different token. Raffle passes the same `cfg.quoteToken` it hands the
     *      prize distributor in the same function, so the two cannot diverge.
     * @param seasonId  The season identifier.
     * @param bonusBps  Bonus in basis points (0 = use defaultBonusBps).
     * @param token     The ERC-20 this cohort holds (the season's quote token).
     */
    function openCohort(uint256 seasonId, uint16 bonusBps, address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CohortState storage cohort = _cohorts[seasonId];
        if (cohort.phase != EscrowPhase.None) {
            revert InvalidPhaseTransition(seasonId, cohort.phase, EscrowPhase.Open);
        }

        if (token == address(0)) revert QuoteTokenNotSet(seasonId);

        uint16 bps = bonusBps == 0 ? defaultBonusBps : bonusBps;
        cohort.phase = EscrowPhase.Open;
        cohort.bonusBps = bps;
        cohort.openedAt = uint40(block.timestamp);
        cohort.token = token;

        emit CohortOpened(seasonId, bps, token);
    }

    /**
     * @notice Transition a cohort from Open to Active (deposits locked, spend enabled).
     * @param seasonId      The season cohort.
     * @param nextSeasonId  The next season tickets will be purchased for.
     * @param _bondingCurve The bonding curve deployed for nextSeasonId. Locked in
     *                      here so spendFromRollover always targets the correct curve.
     */
    function activateCohort(uint256 seasonId, uint256 nextSeasonId, address _bondingCurve)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _checkAndUpdateExpiry(seasonId);

        if (_bondingCurve == address(0)) revert BondingCurveNotSet();

        CohortState storage cohort = _cohorts[seasonId];
        if (cohort.phase != EscrowPhase.Open) {
            revert InvalidPhaseTransition(seasonId, cohort.phase, EscrowPhase.Active);
        }

        // The curve only accepts its own quote token. A cohort funded in season N's
        // token cannot buy tickets on a curve priced in something else, so reject the
        // mismatch loudly here rather than letting every spend or refund pay out the
        // wrong asset. Rolling across tokens would need a swap the escrow cannot do.
        address curveToken = address(SOFBondingCurve(_bondingCurve).quoteToken());
        if (curveToken != cohort.token) {
            revert QuoteTokenMismatch(seasonId, cohort.token, curveToken);
        }

        cohort.phase = EscrowPhase.Active;
        cohort.nextSeasonId = nextSeasonId;
        cohort.bondingCurve = _bondingCurve;

        emit CohortActivated(seasonId, nextSeasonId, _bondingCurve);
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
        uint16 oldBps = defaultBonusBps;
        defaultBonusBps = newBps;
        emit DefaultBonusBpsUpdated(oldBps, newBps);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
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
     *         pulled from treasury when the treasury can fund it.
     * @dev The bonus is paid in the cohort's own token. A season priced in a launch token
     *      has a treasury that may hold none of it, so rather than revert every spend, an
     *      unfundable bonus is skipped (`BonusUnfunded`) and the spend goes ahead at the base
     *      amount. `getBonusAmount` reports the same funded figure, so a client quoting
     *      from it prices the tickets the curve will actually charge for.
     * @param seasonId     The rollover cohort season.
     * @param quoteAmount    Amount of rollover balance to spend (must not exceed available balance).
     * @param ticketAmount Number of raffle tickets to buy (pre-calculated by UI).
     * @param maxTotalQuote  Slippage cap: maximum quote token (base + bonus) the curve may charge.
     */
    function spendFromRollover(uint256 seasonId, uint256 quoteAmount, uint256 ticketAmount, uint256 maxTotalQuote)
        external
        nonReentrant
        whenNotPaused
        whenPhaseActive(seasonId)
    {
        if (quoteAmount == 0) revert AmountZero();

        UserPosition storage pos = _positions[seasonId][msg.sender];
        uint256 available = pos.deposited - pos.spent;
        if (quoteAmount > available) revert ExceedsBalance(quoteAmount, available);

        CohortState storage cohort = _cohorts[seasonId];
        address curve = cohort.bondingCurve;
        uint256 bonusWanted = (quoteAmount * uint256(cohort.bonusBps)) / 10_000;
        uint256 bonusAmount = _fundable(cohort.token, bonusWanted) ? bonusWanted : 0;
        if (bonusWanted > 0 && bonusAmount == 0) emit BonusUnfunded(msg.sender, seasonId, bonusWanted);

        // Checks-effects-interactions: update state before external calls
        pos.spent += quoteAmount;
        cohort.totalSpent += quoteAmount;
        cohort.totalBonusPaid += bonusAmount;

        // The cohort's token, fixed at openCohort and validated against the curve at
        // activateCohort, so these three calls cannot disagree with what the curve wants.
        IERC20 token = IERC20(cohort.token);

        // Pull bonus from treasury into this contract
        if (bonusAmount > 0) token.safeTransferFrom(treasury, address(this), bonusAmount);

        // Approve curve for the total (base + bonus)
        uint256 totalQuote = quoteAmount + bonusAmount;
        token.approve(curve, totalQuote);

        // Buy tickets for user via the cohort's bonding curve
        SOFBondingCurve(curve).buyTokensFor(msg.sender, ticketAmount, maxTotalQuote);

        // Clear any leftover allowance (defense-in-depth)
        token.approve(curve, 0);

        emit RolloverSpend(msg.sender, seasonId, cohort.nextSeasonId, quoteAmount, bonusAmount);
    }

    // -----------------------------------------------------------------------
    // External: Refund (Task 5)
    // -----------------------------------------------------------------------

    /**
     * @notice Refund the caller's unspent rollover balance for a season.
     * @dev Available in Active, Closed, or Expired phases. No whenNotPaused —
     *      users can always exit even when the contract is paused.
     * @param seasonId The season cohort to refund from.
     */
    function refund(uint256 seasonId) external nonReentrant whenPhaseRefundable(seasonId) {
        UserPosition storage pos = _positions[seasonId][msg.sender];
        CohortState storage cohort = _cohorts[seasonId];

        if (pos.refunded) revert AlreadyRefunded(seasonId, msg.sender);

        uint256 refundAmount = pos.deposited - pos.spent;
        if (refundAmount == 0) revert NothingToRefund(seasonId, msg.sender);

        // CEI: state update before transfer
        pos.refunded = true;

        IERC20(cohort.token).safeTransfer(msg.sender, refundAmount);

        emit RolloverRefund(msg.sender, seasonId, refundAmount);
    }

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
     * @notice Returns the bonus a spend of `amount` would receive in a season: the cohort's
     *         bonus rate, or zero while the treasury cannot fund it (see spendFromRollover).
     */
    function getBonusAmount(uint256 seasonId, uint256 amount) external view returns (uint256) {
        CohortState storage cohort = _cohorts[seasonId];
        uint256 wanted = (amount * uint256(cohort.bonusBps)) / 10_000;
        return _fundable(cohort.token, wanted) ? wanted : 0;
    }

    /// @dev Whether the treasury can pay `amount` of `token` to this contract right now.
    function _fundable(address token, uint256 amount) internal view returns (bool) {
        if (amount == 0 || token == address(0)) return amount == 0;
        return IERC20(token).balanceOf(treasury) >= amount
            && IERC20(token).allowance(treasury, address(this)) >= amount;
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
