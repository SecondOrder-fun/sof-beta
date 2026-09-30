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
error StartPriceOutOfRange(uint256 startPriceWei, uint256 min, uint256 max);
error PlacerNotSet();
error LaunchpadHoldsResidualTokens(uint256 amount);
error InvalidPriceBounds();

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
 *      - **No free creator allocation.** The creator receives no tokens here, by any
 *        path. A creator who wants a position buys it like anyone else, at the same
 *        price, after the pool exists.
 *      - **No reserved supply.** The entire supply is placed as liquidity. Single-sided
 *        placement removed the separate LP bucket, and funding the InfoFi seed from
 *        trading fees removed the seed bucket, so a launched token has no overhang at all.
 *      - **Creator-set starting price, standard ladder above it.** `startPriceWei` is the
 *        one expressive parameter of a launch; the band structure above it is the
 *        placer's, identically for every token. A fully creator-configurable shape lets
 *        a creator build a predatory curve that every buyer would have to read to spot.
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

    /// @notice Starting-price bounds, in wei of ETH per whole token.
    ///
    /// @dev **Set these in FDV terms, not in wei.** A price is meaningless on its own: what
    ///      matters is `price * supply`, the implied fully-diluted valuation, and with a
    ///      1e9 supply the two are nine orders of magnitude apart. Use `impliedFdvWei` to
    ///      convert.
    ///
    ///      This is not hypothetical. At 1e6 wei per token the implied FDV is 0.001 ETH,
    ///      and a single 0.1 ETH buy consumes the entire position and drives the pool to
    ///      MIN_TICK — the launch is over before anyone else arrives. A floor of 1e9 wei
    ///      per token is an FDV of 1 ETH, which behaves sanely.
    uint256 public minStartPriceWei;
    uint256 public maxStartPriceWei;

    struct Launch {
        address token;
        address creator;
        uint64 launchedAt;
        uint256 startPriceWei;
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
        uint256 startPriceWei,
        bytes32 placementId
    );
    event PlacerUpdated(address indexed previous, address indexed current);
    event RouterUpdated(address indexed previous, address indexed current);
    event StartPriceBoundsUpdated(uint256 minWei, uint256 maxWei);

    constructor(address admin, address _placer, uint256 _minStartPriceWei, uint256 _maxStartPriceWei) {
        if (admin == address(0)) revert InvalidAddress();
        if (_minStartPriceWei == 0 || _maxStartPriceWei < _minStartPriceWei) revert InvalidPriceBounds();

        placer = ILiquidityPlacer(_placer); // may be zero; set before the first launch
        minStartPriceWei = _minStartPriceWei;
        maxStartPriceWei = _maxStartPriceWei;

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
     * @param startPriceWei Starting price in wei of ETH per whole token.
     * @return launchId The launch's index.
     * @return token    The deployed token.
     */
    function launch(string calldata name, string calldata symbol, string calldata metadataURI, uint256 startPriceWei)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 launchId, address token)
    {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(symbol).length > MAX_SYMBOL_LENGTH) revert SymbolTooLong();
        if (startPriceWei < minStartPriceWei || startPriceWei > maxStartPriceWei) {
            revert StartPriceOutOfRange(startPriceWei, minStartPriceWei, maxStartPriceWei);
        }

        ILiquidityPlacer currentPlacer = placer;
        if (address(currentPlacer) == address(0)) revert PlacerNotSet();

        LaunchToken launched = new LaunchToken(name, symbol, TOKEN_SUPPLY, msg.sender);
        token = address(launched);

        // Hand the entire supply to the placer. Nothing is withheld for the creator or
        // for the protocol — see the contract docs.
        IERC20(token).safeTransfer(address(currentPlacer), TOKEN_SUPPLY);
        bytes32 placementId = currentPlacer.place(token, TOKEN_SUPPLY, startPriceWei);

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
                startPriceWei: startPriceWei,
                placementId: placementId,
                placer: address(currentPlacer)
            })
        );
        _launchIdPlusOne[token] = launchId + 1;

        emit TokenLaunched(launchId, token, msg.sender, name, symbol, metadataURI, startPriceWei, placementId);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice The fully-diluted valuation a start price implies, in wei.
    /// @dev The number to reason about when choosing `minStartPriceWei`/`maxStartPriceWei`,
    ///      and the number worth showing a creator on the launch form.
    function impliedFdvWei(uint256 startPriceWei) public pure returns (uint256) {
        return startPriceWei * (TOKEN_SUPPLY / 1e18);
    }

    /// @notice The configured bounds expressed as implied FDV, in wei.
    function startPriceBoundsAsFdvWei() external view returns (uint256 minFdvWei, uint256 maxFdvWei) {
        return (impliedFdvWei(minStartPriceWei), impliedFdvWei(maxStartPriceWei));
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

    function setStartPriceBounds(uint256 minWei, uint256 maxWei) external onlyRole(CONFIG_ROLE) {
        if (minWei == 0 || maxWei < minWei) revert InvalidPriceBounds();
        minStartPriceWei = minWei;
        maxStartPriceWei = maxWei;
        emit StartPriceBoundsUpdated(minWei, maxWei);
    }

    /// @notice Stop new launches. Existing pools are unaffected and keep trading.
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }
}
