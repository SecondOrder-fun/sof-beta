// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "openzeppelin-contracts/contracts/token/ERC721/utils/ERC721Holder.sol";
import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IRafflePrizeDistributor} from "../lib/IRafflePrizeDistributor.sol";

error InvalidTier(uint256 tier, uint256 maxTier);
error NoTiersConfigured(uint256 seasonId);
error ZeroWinnersInTier(uint256 tierIndex);
error NotATierWinner(uint256 seasonId, address caller);
error NoWinnersInTier(uint256 seasonId, uint256 tierIndex);
error TierConfigFailed();
error NotAParticipant(uint256 seasonId, address caller);

/**
 * @title RafflePrizeDistributor
 * @notice Holds SOF funds for each season and enables claims for the grand winner and
 *         consolation recipients via direct equal distribution.
 *         Also manages sponsored ERC-20 and ERC-721 prizes.
 */
contract RafflePrizeDistributor is IRafflePrizeDistributor, AccessControl, ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    bytes32 public constant RAFFLE_ROLE = keccak256("RAFFLE_ROLE");

    struct SponsoredERC20 {
        address token;
        uint256 amount;
        address sponsor;
        uint256 targetTier; // 0-indexed tier
    }

    struct SponsoredERC721 {
        address token;
        uint256 tokenId;
        address sponsor;
        uint256 targetTier; // 0-indexed tier
    }

    struct Season {
        address token; // SOF token
        address grandWinner; // grand prize winner
        uint256 grandAmount; // SOF allocated to grand winner
        uint256 consolationAmount; // SOF allocated to consolation receivers
        uint256 totalParticipants; // total number of participants (including grand winner)
        bool funded; // whether `expected = grand + consolation` has been funded
        bool grandClaimed; // whether grand was claimed
        bool sponsorshipsLocked; // whether sponsorships are locked (season ended)
    }

    // seasonId => season
    mapping(uint256 => Season) private _seasons;

    // seasonId => participant => claimed status
    mapping(uint256 => mapping(address => bool)) private _consolationClaimed;

    // seasonId => participant => eligible for consolation
    mapping(uint256 => mapping(address => bool)) private _consolationEligible;

    // seasonId => array of sponsored ERC-20 tokens
    mapping(uint256 => SponsoredERC20[]) private _sponsoredERC20;

    // seasonId => array of sponsored ERC-721 tokens
    mapping(uint256 => SponsoredERC721[]) private _sponsoredERC721;

    // seasonId => token => total amount (for ERC-20)
    mapping(uint256 => mapping(address => uint256)) private _erc20TotalByToken;

    // Tier configuration: seasonId => TierConfig[] (index 0 = tier 1, etc.)
    mapping(uint256 => IRafflePrizeDistributor.TierConfig[]) private _tierConfigs;

    // Tier winners: seasonId => tier index => winner addresses
    mapping(uint256 => mapping(uint256 => address[])) private _tierWinners;

    // Reverse lookup: seasonId => address => (isTierWinner, tierIndex)
    mapping(uint256 => mapping(address => uint256)) private _winnerTierIndex;
    mapping(uint256 => mapping(address => bool)) private _isTierWinner;

    // Claim tracking for tiered sponsored prizes: seasonId => prize index => winner => claimed
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) private _sponsoredERC20Claimed;
    mapping(uint256 => mapping(uint256 => bool)) private _sponsoredERC721Claimed;

    event AdminGranted(address indexed account);
    event AdminRevoked(address indexed account);

    event ERC20Sponsored(uint256 indexed seasonId, address indexed sponsor, address indexed token, uint256 amount);

    event ERC721Sponsored(uint256 indexed seasonId, address indexed sponsor, address indexed token, uint256 tokenId);

    event SponsorshipsLocked(uint256 indexed seasonId);

    event SponsoredERC20Claimed(
        uint256 indexed seasonId, address indexed winner, address indexed token, uint256 amount
    );

    event SponsoredERC721Claimed(
        uint256 indexed seasonId, address indexed winner, address indexed token, uint256 tokenId
    );

    constructor(address initialAdmin) {
        address admin = initialAdmin == address(0) ? msg.sender : initialAdmin;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ----------------------- Admin helpers -----------------------

    function grantAdmin(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(DEFAULT_ADMIN_ROLE, account);
        emit AdminGranted(account);
    }

    function revokeAdmin(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DEFAULT_ADMIN_ROLE, account);
        emit AdminRevoked(account);
    }

    // ---------------- IRafflePrizeDistributor --------------------

    function configureSeason(
        uint256 seasonId,
        address token,
        address grandWinner,
        uint256 grandAmount,
        uint256 consolationAmount,
        uint256 totalParticipants
    ) external override onlyRole(RAFFLE_ROLE) {
        require(token != address(0), "Distributor: token zero");
        require(grandWinner != address(0), "Distributor: winner zero");
        require(grandAmount > 0, "Distributor: grand 0");
        require(totalParticipants > 0, "Distributor: participants 0");
        Season storage s = _seasons[seasonId];

        s.token = token;
        s.grandWinner = grandWinner;
        s.grandAmount = grandAmount;
        s.consolationAmount = consolationAmount;
        s.totalParticipants = totalParticipants;
        // keep existing funded/grandClaimed as-is

        emit SeasonConfigured(seasonId, token, grandWinner, grandAmount, consolationAmount, totalParticipants);
    }

    /**
     * @notice Register addresses eligible for consolation claims
     * @dev Must be called by RAFFLE_ROLE before participants can claim consolation prizes.
     *      Can be called multiple times to add more participants (e.g., in batches).
     * @param seasonId The season to set eligibility for
     * @param participants Array of participant addresses to mark as eligible
     */
    function setConsolationEligible(uint256 seasonId, address[] calldata participants)
        external
        override
        onlyRole(RAFFLE_ROLE)
    {
        for (uint256 i = 0; i < participants.length; i++) {
            _consolationEligible[seasonId][participants[i]] = true;
        }
        emit ConsolationEligibilitySet(seasonId, participants.length);
    }

    function fundSeason(uint256 seasonId, uint256 amount) external override onlyRole(RAFFLE_ROLE) {
        Season storage s = _seasons[seasonId];
        require(!s.funded, "Distributor: already funded");
        require(s.token != address(0), "Distributor: not configured");
        uint256 expected = s.grandAmount + s.consolationAmount;
        require(amount == expected, "Distributor: amount mismatch");
        require(IERC20(s.token).balanceOf(address(this)) >= expected, "Distributor: insufficient balance");
        s.funded = true;
        emit SeasonFunded(seasonId, amount);
    }

    function claimGrand(uint256 seasonId) external override nonReentrant {
        Season storage s = _seasons[seasonId];
        require(s.funded, "Distributor: not funded");
        require(!s.grandClaimed, "Distributor: grand claimed");
        require(msg.sender == s.grandWinner, "Distributor: not winner");

        s.grandClaimed = true;
        IERC20(s.token).safeTransfer(msg.sender, s.grandAmount);
        emit GrandClaimed(seasonId, msg.sender, s.grandAmount);
    }

    function claimConsolation(uint256 seasonId) external override nonReentrant {
        Season storage s = _seasons[seasonId];
        require(s.funded, "Distributor: not funded");
        require(msg.sender != s.grandWinner, "Distributor: winner cannot claim consolation");
        require(!_consolationClaimed[seasonId][msg.sender], "Distributor: already claimed");
        require(s.totalParticipants > 1, "Distributor: no other participants");

        // Verify caller was a participant in this season
        if (!_consolationEligible[seasonId][msg.sender]) {
            revert NotAParticipant(seasonId, msg.sender);
        }

        // Calculate equal share for each loser
        uint256 loserCount = s.totalParticipants - 1; // Exclude grand winner
        uint256 amount = s.consolationAmount / loserCount;
        require(amount > 0, "Distributor: amount zero");

        _consolationClaimed[seasonId][msg.sender] = true;
        IERC20(s.token).safeTransfer(msg.sender, amount);
        emit ConsolationClaimed(seasonId, msg.sender, amount);
    }

    function isConsolationClaimed(uint256 seasonId, address account) external view override returns (bool) {
        return _consolationClaimed[seasonId][account];
    }

    /// @notice Check if an address is eligible for consolation claims
    /// @param seasonId The season to check
    /// @param account The address to check
    /// @return Whether the address is eligible
    function isConsolationEligible(uint256 seasonId, address account) external view override returns (bool) {
        return _consolationEligible[seasonId][account];
    }

    function getSeason(uint256 seasonId) external view override returns (SeasonPayouts memory) {
        Season storage s = _seasons[seasonId];
        return SeasonPayouts({
            token: s.token,
            grandWinner: s.grandWinner,
            grandAmount: s.grandAmount,
            consolationAmount: s.consolationAmount,
            totalParticipants: s.totalParticipants,
            funded: s.funded,
            grandClaimed: s.grandClaimed
        });
    }

    // ----------------------- Sponsorship functions --------------------

    /**
     * @notice Sponsor ERC-20 tokens to a season's prize pool at a specific tier
     * @param seasonId The season to sponsor
     * @param token The ERC-20 token address
     * @param amount The amount to sponsor
     * @param targetTier The 0-indexed tier this prize is for
     */
    function sponsorERC20(uint256 seasonId, address token, uint256 amount, uint256 targetTier) external nonReentrant {
        require(seasonId > 0, "Distributor: invalid season");
        require(token != address(0), "Distributor: zero address");
        require(amount > 0, "Distributor: zero amount");
        Season storage s = _seasons[seasonId];
        require(!s.sponsorshipsLocked, "Distributor: sponsorships locked");

        // Validate target tier if tiers are configured
        IRafflePrizeDistributor.TierConfig[] storage tiers = _tierConfigs[seasonId];
        if (tiers.length > 0) {
            if (targetTier >= tiers.length) revert InvalidTier(targetTier, tiers.length);
        }

        // Transfer tokens from sponsor to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Record sponsorship
        _sponsoredERC20[seasonId].push(
            SponsoredERC20({token: token, amount: amount, sponsor: msg.sender, targetTier: targetTier})
        );

        // Update total for this token
        _erc20TotalByToken[seasonId][token] += amount;

        emit ERC20Sponsored(seasonId, msg.sender, token, amount);
    }

    /**
     * @notice Sponsor an ERC-721 NFT to a season's prize pool at a specific tier
     * @param seasonId The season to sponsor
     * @param token The ERC-721 token address
     * @param tokenId The NFT token ID
     * @param targetTier The 0-indexed tier this NFT goes to (first winner of that tier receives it)
     */
    function sponsorERC721(uint256 seasonId, address token, uint256 tokenId, uint256 targetTier) external nonReentrant {
        require(seasonId > 0, "Distributor: invalid season");
        require(token != address(0), "Distributor: zero address");
        Season storage s = _seasons[seasonId];
        require(!s.sponsorshipsLocked, "Distributor: sponsorships locked");

        // Validate target tier if tiers are configured
        IRafflePrizeDistributor.TierConfig[] storage tiers = _tierConfigs[seasonId];
        if (tiers.length > 0) {
            if (targetTier >= tiers.length) revert InvalidTier(targetTier, tiers.length);
        }

        // Transfer NFT from sponsor to this contract
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);

        // Record sponsorship
        _sponsoredERC721[seasonId].push(
            SponsoredERC721({token: token, tokenId: tokenId, sponsor: msg.sender, targetTier: targetTier})
        );

        emit ERC721Sponsored(seasonId, msg.sender, token, tokenId);
    }

    /**
     * @notice Lock sponsorships for a season (called when season ends)
     * @param seasonId The season to lock
     */
    function lockSponsorships(uint256 seasonId) external onlyRole(RAFFLE_ROLE) {
        Season storage s = _seasons[seasonId];
        require(!s.sponsorshipsLocked, "Distributor: already locked");
        s.sponsorshipsLocked = true;
        emit SponsorshipsLocked(seasonId);
    }

    /**
     * @notice Configure tier structure for a season's sponsored prizes
     * @param seasonId The season to configure
     * @param tiers Array of TierConfig (index 0 = tier 1, etc.)
     */
    function configureTiers(uint256 seasonId, IRafflePrizeDistributor.TierConfig[] calldata tiers)
        external
        onlyRole(RAFFLE_ROLE)
    {
        if (seasonId == 0) revert("Distributor: invalid season");
        if (tiers.length == 0) revert NoTiersConfigured(seasonId);

        // Clear existing tiers
        delete _tierConfigs[seasonId];

        uint256 totalWinners = 0;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i].winnerCount == 0) revert ZeroWinnersInTier(i);
            _tierConfigs[seasonId].push(tiers[i]);
            totalWinners += tiers[i].winnerCount;
        }

        emit TiersConfigured(seasonId, tiers.length, totalWinners);
    }

    /**
     * @notice Map the flat winner array from VRF to tiers
     * @param seasonId The season
     * @param allWinners Flat array of winners ordered by tier (tier 0 winners first, then tier 1, etc.)
     */
    function setTierWinners(uint256 seasonId, address[] calldata allWinners) external onlyRole(RAFFLE_ROLE) {
        IRafflePrizeDistributor.TierConfig[] storage tiers = _tierConfigs[seasonId];
        if (tiers.length == 0) revert NoTiersConfigured(seasonId);

        uint256 offset = 0;
        for (uint256 t = 0; t < tiers.length; t++) {
            // Clear existing tier winners
            delete _tierWinners[seasonId][t];

            uint256 count = tiers[t].winnerCount;
            for (uint256 w = 0; w < count && offset + w < allWinners.length; w++) {
                address winner = allWinners[offset + w];
                _tierWinners[seasonId][t].push(winner);
                _winnerTierIndex[seasonId][winner] = t;
                _isTierWinner[seasonId][winner] = true;
            }
            offset += count;
        }

        emit TierWinnersSet(seasonId, tiers.length);
    }

    /**
     * @notice Claim sponsored ERC-20 tokens for caller's tier
     * @param seasonId The season to claim from
     */
    function claimSponsoredERC20(uint256 seasonId) external nonReentrant {
        Season storage s = _seasons[seasonId];
        require(s.funded, "Distributor: not funded");
        require(s.sponsorshipsLocked, "Distributor: not locked");

        IRafflePrizeDistributor.TierConfig[] storage tiers = _tierConfigs[seasonId];

        // If no tiers configured, fall back to legacy behavior (grand winner gets all)
        if (tiers.length == 0) {
            require(msg.sender == s.grandWinner, "Distributor: not winner");
            SponsoredERC20[] memory legacySponsored = _sponsoredERC20[seasonId];
            for (uint256 i = 0; i < legacySponsored.length; i++) {
                IERC20(legacySponsored[i].token).safeTransfer(msg.sender, legacySponsored[i].amount);
                emit SponsoredERC20Claimed(seasonId, msg.sender, legacySponsored[i].token, legacySponsored[i].amount);
            }
            delete _sponsoredERC20[seasonId];
            return;
        }

        // Tiered claim: caller must be a tier winner
        if (!_isTierWinner[seasonId][msg.sender]) revert NotATierWinner(seasonId, msg.sender);
        uint256 callerTier = _winnerTierIndex[seasonId][msg.sender];
        uint256 tierWinnerCount = _tierWinners[seasonId][callerTier].length;
        if (tierWinnerCount == 0) revert NoWinnersInTier(seasonId, callerTier);

        SponsoredERC20[] storage sponsored = _sponsoredERC20[seasonId];
        for (uint256 i = 0; i < sponsored.length; i++) {
            if (sponsored[i].targetTier != callerTier) continue;
            if (_sponsoredERC20Claimed[seasonId][i][msg.sender]) continue;

            uint256 share = sponsored[i].amount / tierWinnerCount;
            if (share == 0) continue;

            _sponsoredERC20Claimed[seasonId][i][msg.sender] = true;
            IERC20(sponsored[i].token).safeTransfer(msg.sender, share);
            emit SponsoredERC20Claimed(seasonId, msg.sender, sponsored[i].token, share);
        }
    }

    /**
     * @notice Claim sponsored ERC-721 tokens for caller's tier
     * @param seasonId The season to claim from
     */
    function claimSponsoredERC721(uint256 seasonId) external nonReentrant {
        Season storage s = _seasons[seasonId];
        require(s.funded, "Distributor: not funded");
        require(s.sponsorshipsLocked, "Distributor: not locked");

        IRafflePrizeDistributor.TierConfig[] storage tiers = _tierConfigs[seasonId];

        // If no tiers configured, fall back to legacy behavior
        if (tiers.length == 0) {
            require(msg.sender == s.grandWinner, "Distributor: not winner");
            SponsoredERC721[] memory legacySponsored = _sponsoredERC721[seasonId];
            for (uint256 i = 0; i < legacySponsored.length; i++) {
                IERC721(legacySponsored[i].token).safeTransferFrom(address(this), msg.sender, legacySponsored[i].tokenId);
                emit SponsoredERC721Claimed(seasonId, msg.sender, legacySponsored[i].token, legacySponsored[i].tokenId);
            }
            delete _sponsoredERC721[seasonId];
            return;
        }

        // Tiered claim: NFTs go to the first winner of the target tier
        if (!_isTierWinner[seasonId][msg.sender]) revert NotATierWinner(seasonId, msg.sender);
        uint256 callerTier = _winnerTierIndex[seasonId][msg.sender];

        SponsoredERC721[] storage sponsored = _sponsoredERC721[seasonId];
        for (uint256 i = 0; i < sponsored.length; i++) {
            if (sponsored[i].targetTier != callerTier) continue;
            if (_sponsoredERC721Claimed[seasonId][i]) continue;

            // NFT goes to first winner of the tier only
            address firstWinner = _tierWinners[seasonId][callerTier][0];
            if (msg.sender != firstWinner) continue;

            _sponsoredERC721Claimed[seasonId][i] = true;
            IERC721(sponsored[i].token).safeTransferFrom(address(this), msg.sender, sponsored[i].tokenId);
            emit SponsoredERC721Claimed(seasonId, msg.sender, sponsored[i].token, sponsored[i].tokenId);
        }
    }

    /**
     * @notice Get all sponsored ERC-20 tokens for a season
     * @param seasonId The season to query
     * @return Array of SponsoredERC20 structs
     */
    function getSponsoredERC20(uint256 seasonId) external view returns (SponsoredERC20[] memory) {
        return _sponsoredERC20[seasonId];
    }

    /**
     * @notice Get all sponsored ERC-721 tokens for a season
     * @param seasonId The season to query
     * @return Array of SponsoredERC721 structs
     */
    function getSponsoredERC721(uint256 seasonId) external view returns (SponsoredERC721[] memory) {
        return _sponsoredERC721[seasonId];
    }

    /**
     * @notice Get total amount of a specific ERC-20 token sponsored for a season
     * @param seasonId The season to query
     * @param token The token address
     * @return Total amount sponsored
     */
    function getERC20TotalByToken(uint256 seasonId, address token) external view returns (uint256) {
        return _erc20TotalByToken[seasonId][token];
    }

    /**
     * @notice Get tier configuration for a season
     * @param seasonId The season to query
     * @return Array of TierConfig structs
     */
    function getTierConfigs(uint256 seasonId) external view returns (IRafflePrizeDistributor.TierConfig[] memory) {
        return _tierConfigs[seasonId];
    }

    /**
     * @notice Get winners for a specific tier
     * @param seasonId The season to query
     * @param tierIndex The 0-indexed tier
     * @return Array of winner addresses
     */
    function getTierWinners(uint256 seasonId, uint256 tierIndex) external view returns (address[] memory) {
        return _tierWinners[seasonId][tierIndex];
    }

    /**
     * @notice Get which tier a winner is in
     * @param seasonId The season to query
     * @param winner The address to check
     * @return isTierWinner Whether the address is a tier winner
     * @return tierIndex The 0-indexed tier (only valid if isTierWinner is true)
     */
    function getWinnerTier(uint256 seasonId, address winner) external view returns (bool isTierWinner, uint256 tierIndex) {
        isTierWinner = _isTierWinner[seasonId][winner];
        tierIndex = _winnerTierIndex[seasonId][winner];
    }

    /**
     * @notice Check if a specific ERC-20 prize has been claimed by a winner
     * @param seasonId The season
     * @param prizeIndex The index in the sponsored ERC-20 array
     * @param winner The winner address
     * @return Whether it has been claimed
     */
    function isSponsoredERC20Claimed(uint256 seasonId, uint256 prizeIndex, address winner) external view returns (bool) {
        return _sponsoredERC20Claimed[seasonId][prizeIndex][winner];
    }

    /**
     * @notice Check if a specific ERC-721 prize has been claimed
     * @param seasonId The season
     * @param prizeIndex The index in the sponsored ERC-721 array
     * @return Whether it has been claimed
     */
    function isSponsoredERC721Claimed(uint256 seasonId, uint256 prizeIndex) external view returns (bool) {
        return _sponsoredERC721Claimed[seasonId][prizeIndex];
    }
}
