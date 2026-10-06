// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {ILiquidityPlacer} from "./ILiquidityPlacer.sol";
import {ILaunchRouter} from "./ILaunchRouter.sol";

error InvalidAddress();
error EmptyName();
error EmptySymbol();
error NameTooLong();
error SymbolTooLong();
error StartFdvOutOfRange(uint256 startFdv, uint256 min, uint256 max);
error QuoteTokenNotAllowed(address quoteToken);
error QuoteTokenNotAContract(address quoteToken);
error CreatorBuyNeedsRouter();
error EthAmountMismatch(uint256 sent, uint256 expected);
error RefundFailed();
error OnlyRouter();
error PlacerNotSet();
error LaunchpadHoldsResidualTokens(uint256 amount);
error InvalidFdvBounds();

/**
 * @title TokenLaunchpad
 * @notice Permissionless token launches. Deploys a `LaunchToken` and places its whole
 *         supply as tradeable liquidity in one transaction.
 *
 * @dev Design decisions this contract encodes, all recorded in
 *      docs/05-features/launchpad/design.md:
 *
 *      - **No launch fee.** Launching costs gas only. Charging moved to raffle creation,
 *        where the costs (VRF in particular) are actually incurred. No major launchpad
 *        earns from launch fees; Clanker and Pools.trade charge nothing (§1, fee benchmarks).
 *      - **No free creator allocation.** The creator receives no tokens for free, by any
 *        path. A creator who wants a position buys it — optionally in the launch
 *        transaction itself (`creatorBuyIn`), so nobody can buy ahead of them — through
 *        the same router, at the same pool price and trade fee as anyone else.
 *      - **No reserved supply.** The entire supply is placed as liquidity. Single-sided
 *        placement removed the separate LP bucket, and funding the InfoFi seed from
 *        trading fees removed the seed bucket, so a launched token has no overhang at all.
 *      - **Creator-set starting valuation, standard ladder above it.** `startFdv` — the
 *        fully-diluted valuation the token opens at — is the one expressive parameter of
 *        a launch; the band structure above it is the placer's, identically for every
 *        token. A fully creator-configurable shape lets a creator build a predatory curve
 *        that every buyer would have to read to spot. It is a valuation rather than a
 *        per-token price because with a 1e9 supply a price is nine orders of magnitude
 *        smaller and, in a 6-decimal quote token like USDC, too coarse to express: a
 *        5,000 USDC valuation is 5 raw units per token.
 *      - **A choice of quote token, from an allowlist.** A launch is paired with native
 *        ETH (`NATIVE`, the default) or with an ERC-20 that CONFIG_ROLE has allowed
 *        (`setQuoteToken`). Each allowed quote token carries its own valuation bounds,
 *        because a valuation is in that token's raw units and its decimals and value
 *        differ. Only plain ERC-20s belong on the list: a fee-on-transfer or rebasing
 *        token would break the pool's accounting, and the placer and router assume
 *        neither. Never list WETH next to native ETH: it splits every ETH market in two.
 *
 *      Pausing stops NEW launches only. Existing pools are plain Uniswap pools and keep
 *      trading regardless — that is a fact to accept, not a control to build (§6.8).
 */
contract TokenLaunchpad is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    /// @notice Supply minted for every launch. Identical across launches so that one
    ///         number — the starting price — distinguishes any two, which is also what
    ///         makes the discovery feed comparable.
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000e18;

    uint256 public constant MAX_NAME_LENGTH = 48;
    uint256 public constant MAX_SYMBOL_LENGTH = 16;

    /// @notice Where the NEXT launch's supply is placed. Swappable venue (§ILiquidityPlacer).
    /// @dev Each launch records the placer that placed it (`Launch.placer`, `placerOf`), so
    ///      swapping this changes where new launches go and nothing about existing ones:
    ///      routers and clients look a token's pool up through ITS placer, never this one.
    ILiquidityPlacer public placer;

    /// @notice The router the app trades launched tokens through.
    /// @dev A registry pointer for clients, not something this contract calls. Clients
    ///      read it and encode against ILaunchRouter, so replacing the implementation is
    ///      this one setter and no client release. Zero means "no in-app trading" — the
    ///      pools themselves stay tradeable through any other Uniswap route, which is why
    ///      that is a UI switch rather than a pause.
    ILaunchRouter public router;

    /// @notice The quote-token address that means native ETH.
    address public constant NATIVE = address(0);

    /// @notice An allowed quote token and its starting-valuation bounds.
    /// @dev Valuations are the whole supply's worth in the quote token's RAW units (wei
    ///      for ETH, 1e-6 USDC for USDC).
    ///
    ///      The floor is not cosmetic. At an FDV of 0.001 ETH a single 0.1 ETH buy
    ///      consumes the entire position and drives the pool to MIN_TICK — the launch is
    ///      over before anyone else arrives. A 1 ETH floor behaves sanely. An ERC-20
    ///      quote token needs the same floor in its own value.
    struct QuoteConfig {
        bool allowed;
        uint256 minStartFdv;
        uint256 maxStartFdv;
    }

    /// @notice quote token => its config. `NATIVE` (address 0) is ETH.
    mapping(address quoteToken => QuoteConfig) public quoteConfig;

    struct Launch {
        address token;
        address creator;
        uint64 launchedAt;
        /// @dev What the token is paired with: `NATIVE` for ETH, else an ERC-20.
        address quoteToken;
        /// @dev The opening fully-diluted valuation, in `quoteToken`'s raw units.
        uint256 startFdv;
        bytes32 placementId;
        /// @dev The placer that holds this launch's position — where its pool is looked up.
        address placer;
    }

    /// @notice Every launch, in order. Index is the launch id.
    Launch[] private _launches;

    /// @notice token => launch id + 1 (zero means "not a launchpad token").
    mapping(address => uint256) private _launchIdPlusOne;

    event TokenLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI,
        address quoteToken,
        uint256 startFdv,
        uint24 tradeFee,
        bytes32 placementId
    );
    event PlacerUpdated(address indexed previous, address indexed current);
    event RouterUpdated(address indexed previous, address indexed current);
    event QuoteTokenSet(address indexed quoteToken, uint256 minStartFdv, uint256 maxStartFdv);
    event QuoteTokenRemoved(address indexed quoteToken);
    /// @notice The creator's buy made inside the launch transaction.
    event CreatorBought(
        uint256 indexed launchId, address indexed token, address indexed creator, uint256 quoteSpent, uint256 tokensOut
    );

    /// @param _minEthStartFdv Lowest opening valuation for an ETH launch, in wei.
    /// @param _maxEthStartFdv Highest opening valuation for an ETH launch, in wei.
    constructor(address admin, address _placer, uint256 _minEthStartFdv, uint256 _maxEthStartFdv) {
        if (admin == address(0)) revert InvalidAddress();

        placer = ILiquidityPlacer(_placer); // may be zero; set before the first launch
        _setQuoteToken(NATIVE, _minEthStartFdv, _maxEthStartFdv);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Launch
    // ------------------------------------------------------------------

    /**
     * @notice Launch a token. Permissionless; costs gas only.
     * @param name          Token name.
     * @param symbol        Token symbol.
     * @param metadataURI   Off-chain metadata (image, description, socials). Emitted for
     *                      the indexer and deliberately not stored: on-chain storage would
     *                      either cost a fortune or need a setter, and a setter lets a
     *                      creator swap the name or image after people have bought.
     * @param quoteToken    What the token trades against: `NATIVE` (address 0) for ETH,
     *                      or an ERC-20 on the allowlist.
     * @param startFdv      Opening fully-diluted valuation, in `quoteToken`'s raw units:
     *                      what the whole supply is worth at the starting price.
     * @param tradeFee      The pool's trade fee in pips (10_000 = 1%), charged on every
     *                      buy and sell in the quote token and split 88/12 creator/platform.
     *                      Fixed for the pool's life; the placer bounds it (at most 10%).
     * @param creatorBuyIn  Optional first buy for the creator, in `quoteToken`'s raw units,
     *                      made in this transaction right after the pool is placed — before
     *                      anyone else can trade. ETH: send exactly this as `msg.value`.
     *                      ERC-20: approve this contract for it and send no ETH. Zero skips
     *                      the buy (and then no ETH may be sent).
     * @param minTokensOut  The creator buy's slippage floor; the whole launch reverts below it.
     * @return launchId The launch's index.
     * @return token    The deployed token.
     */
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address quoteToken,
        uint256 startFdv,
        uint24 tradeFee,
        uint256 creatorBuyIn,
        uint256 minTokensOut
    ) external payable nonReentrant whenNotPaused returns (uint256 launchId, address token) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(symbol).length > MAX_SYMBOL_LENGTH) revert SymbolTooLong();
        QuoteConfig memory qc = quoteConfig[quoteToken];
        if (!qc.allowed) revert QuoteTokenNotAllowed(quoteToken);
        if (startFdv < qc.minStartFdv || startFdv > qc.maxStartFdv) {
            revert StartFdvOutOfRange(startFdv, qc.minStartFdv, qc.maxStartFdv);
        }
        uint256 expectedValue = quoteToken == NATIVE ? creatorBuyIn : 0;
        if (msg.value != expectedValue) revert EthAmountMismatch(msg.value, expectedValue);

        ILiquidityPlacer currentPlacer = placer;
        if (address(currentPlacer) == address(0)) revert PlacerNotSet();

        LaunchToken launched = new LaunchToken(name, symbol, TOKEN_SUPPLY, msg.sender);
        token = address(launched);

        // Hand the entire supply to the placer. Nothing is withheld for the creator or
        // for the protocol — see the contract docs.
        IERC20(token).safeTransfer(address(currentPlacer), TOKEN_SUPPLY);
        bytes32 placementId = currentPlacer.place(token, TOKEN_SUPPLY, quoteToken, startFdv, tradeFee);

        // The placer must consume everything it was given. A residual balance here would
        // mean supply is stranded in the launchpad, permanently outside both the market
        // and anyone's reach, which is worse than failing the launch.
        uint256 residual = IERC20(token).balanceOf(address(this));
        if (residual != 0) revert LaunchpadHoldsResidualTokens(residual);

        launchId = _launches.length;
        _launches.push(
            Launch({
                token: token,
                creator: msg.sender,
                launchedAt: uint64(block.timestamp),
                quoteToken: quoteToken,
                startFdv: startFdv,
                placementId: placementId,
                placer: address(currentPlacer)
            })
        );
        _launchIdPlusOne[token] = launchId + 1;

        emit TokenLaunched(
            launchId, token, msg.sender, name, symbol, metadataURI, quoteToken, startFdv, tradeFee, placementId
        );

        if (creatorBuyIn != 0) _creatorBuy(launchId, token, quoteToken, creatorBuyIn, minTokensOut);
    }

    /// @dev The creator's first buy, through the active router exactly as any buyer's is,
    ///      so it pays the pool price and fee and is recorded as an ordinary trade. The
    ///      launch is already registered, which the router requires. Whatever a partial fill
    ///      leaves unspent goes back to the creator, so this contract keeps nothing.
    function _creatorBuy(uint256 launchId, address token, address quoteToken, uint256 quoteIn, uint256 minTokensOut)
        private
    {
        ILaunchRouter r = router;
        if (address(r) == address(0)) revert CreatorBuyNeedsRouter();
        // The creator's buy comes before anyone can trade: not a snipe, so no surcharge.
        ILiquidityPlacer(_launches[launchId].placer).exemptNextBuy(token);

        uint256 tokensOut;
        uint256 unspent;
        if (quoteToken == NATIVE) {
            // msg.value is already in the balance; the router refunds any unspent part here.
            uint256 before = address(this).balance - quoteIn;
            tokensOut = r.buy{value: quoteIn}(token, quoteIn, minTokensOut, msg.sender, block.timestamp);
            unspent = address(this).balance - before;
            if (unspent != 0) {
                (bool ok,) = msg.sender.call{value: unspent}("");
                if (!ok) revert RefundFailed();
            }
        } else {
            IERC20 quote = IERC20(quoteToken);
            uint256 before = quote.balanceOf(address(this));
            quote.safeTransferFrom(msg.sender, address(this), quoteIn);
            quote.forceApprove(address(r), quoteIn);
            tokensOut = r.buy(token, quoteIn, minTokensOut, msg.sender, block.timestamp);
            quote.forceApprove(address(r), 0);
            unspent = quote.balanceOf(address(this)) - before;
            if (unspent != 0) quote.safeTransfer(msg.sender, unspent);
        }

        emit CreatorBought(launchId, token, msg.sender, quoteIn - unspent, tokensOut);
    }

    /// @dev ETH arrives only as the router's refund of a creator buy's unspent part.
    receive() external payable {
        if (msg.sender != address(router)) revert OnlyRouter();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice What `token` is paired with: `NATIVE` (address 0) for ETH. Also zero for a
    ///         token not launched here, so check `isLaunchToken` first.
    function quoteTokenOf(address token) external view returns (address) {
        uint256 stored = _launchIdPlusOne[token];
        return stored == 0 ? address(0) : _launches[stored - 1].quoteToken;
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    /// @notice Whether `token` was launched here.
    /// @dev The authority for "is this a launchpad token", which season creation uses to
    ///      decide whether a token may denominate a raffle.
    function isLaunchToken(address token) external view returns (bool) {
        return _launchIdPlusOne[token] != 0;
    }

    /// @notice Who launched `token`; zero if `token` was not launched here.
    function creatorOf(address token) external view returns (address) {
        uint256 stored = _launchIdPlusOne[token];
        return stored == 0 ? address(0) : _launches[stored - 1].creator;
    }

    /// @notice The placer holding `token`'s position; zero if `token` was not launched here.
    /// @dev Where a token's pool is looked up. Not `placer`: that is only where the next
    ///      launch goes, and may have been replaced since this token launched.
    function placerOf(address token) external view returns (address) {
        uint256 stored = _launchIdPlusOne[token];
        return stored == 0 ? address(0) : _launches[stored - 1].placer;
    }

    function launchIdOf(address token) external view returns (uint256 launchId, bool exists) {
        uint256 stored = _launchIdPlusOne[token];
        return stored == 0 ? (0, false) : (stored - 1, true);
    }

    // ------------------------------------------------------------------
    // Config
    // ------------------------------------------------------------------

    /// @notice Where new launches are placed. Existing launches keep the placer that placed
    ///         them (`placerOf`).
    function setPlacer(address _placer) external onlyRole(CONFIG_ROLE) {
        if (_placer == address(0)) revert InvalidAddress();
        emit PlacerUpdated(address(placer), _placer);
        placer = ILiquidityPlacer(_placer);
    }

    /// @notice Point the app at a different router. address(0) turns in-app trading off.
    function setRouter(address _router) external onlyRole(CONFIG_ROLE) {
        emit RouterUpdated(address(router), _router);
        router = ILaunchRouter(_router);
    }

    /// @notice Allow `quoteToken` (or update its bounds). `NATIVE` (address 0) is ETH.
    /// @dev Only plain ERC-20s: no fee-on-transfer, rebasing or callback tokens — see the
    ///      contract docs. Existing launches are unaffected by any change here.
    function setQuoteToken(address quoteToken, uint256 minStartFdv, uint256 maxStartFdv)
        external
        onlyRole(CONFIG_ROLE)
    {
        _setQuoteToken(quoteToken, minStartFdv, maxStartFdv);
    }

    /// @notice Stop new launches pairing with `quoteToken`. Launches already paired with it
    ///         keep trading; this only closes the door to new ones.
    function removeQuoteToken(address quoteToken) external onlyRole(CONFIG_ROLE) {
        if (!quoteConfig[quoteToken].allowed) revert QuoteTokenNotAllowed(quoteToken);
        delete quoteConfig[quoteToken];
        emit QuoteTokenRemoved(quoteToken);
    }

    function _setQuoteToken(address quoteToken, uint256 minStartFdv, uint256 maxStartFdv) private {
        if (quoteToken != NATIVE && quoteToken.code.length == 0) revert QuoteTokenNotAContract(quoteToken);
        if (minStartFdv == 0 || maxStartFdv < minStartFdv) revert InvalidFdvBounds();
        quoteConfig[quoteToken] = QuoteConfig({allowed: true, minStartFdv: minStartFdv, maxStartFdv: maxStartFdv});
        emit QuoteTokenSet(quoteToken, minStartFdv, maxStartFdv);
    }

    /// @notice Stop new launches. Existing pools are unaffected and keep trading.
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }
}
