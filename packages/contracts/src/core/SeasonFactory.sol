// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/access/AccessControl.sol";
import "openzeppelin-contracts/contracts/utils/Strings.sol";
import "../token/RaffleToken.sol";
import "../curve/SOFBondingCurve.sol";
import "../lib/RaffleTypes.sol";
import "../lib/IRaffle.sol";

/**
 * @title SeasonFactory
 * @notice Deploys and configures all contracts for a new season.
 */
contract SeasonFactory is AccessControl {
    bytes32 public constant RAFFLE_ADMIN_ROLE = keccak256("RAFFLE_ADMIN_ROLE");

    address public immutable raffleAddress;
    address public immutable deployerAddress;

    event SeasonContractsDeployed(uint256 indexed seasonId, address indexed raffleToken, address indexed bondingCurve);

    constructor(address _raffleAddress) {
        raffleAddress = _raffleAddress;
        deployerAddress = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RAFFLE_ADMIN_ROLE, _raffleAddress);
    }

    function createSeasonContracts(
        uint256 seasonId,
        RaffleTypes.SeasonConfig calldata config,
        RaffleTypes.BondStep[] calldata bondSteps,
        uint16 buyFeeBps,
        uint16 sellFeeBps
    ) external onlyRole(RAFFLE_ADMIN_ROLE) returns (address raffleTokenAddr, address curveAddr) {
        // Deploy RaffleToken for this season
        RaffleToken raffleToken = new RaffleToken(
            string(abi.encodePacked("SecondOrder ", config.name)),
            string(abi.encodePacked("SOF-", Strings.toString(seasonId))),
            seasonId,
            config.name,
            config.startTime,
            config.endTime
        );
        raffleTokenAddr = address(raffleToken);

        // Deploy curve for this season with transaction originator as admin
        // tx.origin is the wallet that initiated the createSeason transaction
        SOFBondingCurve curve = new SOFBondingCurve(address(IRaffle(raffleAddress).sofToken()), tx.origin);
        curveAddr = address(curve);

        // Grant RAFFLE_MANAGER_ROLE to this factory temporarily to initialize, and to Raffle permanently
        curve.grantRole(curve.RAFFLE_MANAGER_ROLE(), address(this));
        curve.grantRole(curve.RAFFLE_MANAGER_ROLE(), raffleAddress);

        // Initialize the curve (requires RAFFLE_MANAGER_ROLE)
        curve.initializeCurve(raffleTokenAddr, bondSteps, buyFeeBps, sellFeeBps, config.treasuryAddress);
        curve.setRaffleInfo(raffleAddress, seasonId);

        // Grant curve rights on raffle token
        raffleToken.grantRole(raffleToken.MINTER_ROLE(), curveAddr);
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), curveAddr);

        emit SeasonContractsDeployed(seasonId, raffleTokenAddr, curveAddr);
    }

    function grantCurveManagerRole(address curveAddr, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SOFBondingCurve(curveAddr).grantRole(SOFBondingCurve(curveAddr).RAFFLE_MANAGER_ROLE(), account);
    }
}
