// src/utils/abis.js
// Centralized ABI exports with tree-shaking support
// Handles both Foundry artifacts ({abi: [...]}) and plain arrays ([...])

// Helper to extract abi array from Foundry JSON or return as-is
const extractAbi = (json) => json.abi || json;

// Core Raffle System
import _RaffleAbi from '@/contracts/abis/Raffle.json';
import _RafflePositionTrackerAbi from '@/contracts/abis/RafflePositionTracker.json';
import _RafflePrizeDistributorAbi from '@/contracts/abis/RafflePrizeDistributor.json';
import _RaffleTokenAbi from '@/contracts/abis/RaffleToken.json';

export const RaffleAbi = extractAbi(_RaffleAbi);
export const RafflePositionTrackerAbi = extractAbi(_RafflePositionTrackerAbi);
export const RafflePrizeDistributorAbi = extractAbi(_RafflePrizeDistributorAbi);
export const RaffleTokenAbi = extractAbi(_RaffleTokenAbi);

// InfoFi Prediction Markets (Legacy)
import _InfoFiMarketAbi from '@/contracts/abis/InfoFiMarket.json';
import _InfoFiMarketFactoryAbi from '@/contracts/abis/InfoFiMarketFactory.json';
import _InfoFiPriceOracleAbi from '@/contracts/abis/InfoFiPriceOracle.json';
import _InfoFiSettlementAbi from '@/contracts/abis/InfoFiSettlement.json';

export const InfoFiMarketAbi = extractAbi(_InfoFiMarketAbi);
export const InfoFiMarketFactoryAbi = extractAbi(_InfoFiMarketFactoryAbi);
export const InfoFiPriceOracleAbi = extractAbi(_InfoFiPriceOracleAbi);
export const InfoFiSettlementAbi = extractAbi(_InfoFiSettlementAbi);

// InfoFi FPMM (V2)
import _RaffleOracleAdapterAbi from '@/contracts/abis/RaffleOracleAdapter.json';
import _InfoFiFPMMV2Abi from '@/contracts/abis/InfoFiFPMMV2.json';
import _SimpleFPMMAbi from '@/contracts/abis/SimpleFPMM.json';
import _SOLPTokenAbi from '@/contracts/abis/SOLPToken.json';
import _ConditionalTokensMockAbi from '@/contracts/abis/ConditionalTokensMock.json';

export const RaffleOracleAdapterAbi = extractAbi(_RaffleOracleAdapterAbi);
export const InfoFiFPMMV2Abi = extractAbi(_InfoFiFPMMV2Abi);
export const SimpleFPMMAbi = extractAbi(_SimpleFPMMAbi);
export const SOLPTokenAbi = extractAbi(_SOLPTokenAbi);
export const ConditionalTokensMockAbi = extractAbi(_ConditionalTokensMockAbi);

// Bonding Curve & Tokens
import _SOFBondingCurveAbi from '@/contracts/abis/SOFBondingCurve.json';
import _SOFTokenAbi from '@/contracts/abis/SOFToken.json';
import _SOFFaucetAbi from '@/contracts/abis/SOFFaucet.json';

export const SOFBondingCurveAbi = extractAbi(_SOFBondingCurveAbi);
export const SOFTokenAbi = extractAbi(_SOFTokenAbi);
export const SOFFaucetAbi = extractAbi(_SOFFaucetAbi);

// Season Management
import _SeasonFactoryAbi from '@/contracts/abis/SeasonFactory.json';

export const SeasonFactoryAbi = extractAbi(_SeasonFactoryAbi);

// Standard Interfaces
import _ERC20Abi from '@/contracts/abis/ERC20.json';
import _AccessControlAbi from '@/contracts/abis/AccessControl.json';

export const ERC20Abi = extractAbi(_ERC20Abi);
export const AccessControlAbi = extractAbi(_AccessControlAbi);

// Minimal ERC-721 ABI for approve calls
export const ERC721ApproveAbi = [
  { name: "approve", type: "function", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
];

// Hats Protocol (Sponsor Staking)
import _HatsAbi from '@/contracts/abis/Hats.json';
import _StakingEligibilityAbi from '@/contracts/abis/StakingEligibility.json';

export const HatsAbi = extractAbi(_HatsAbi);
export const StakingEligibilityAbi = extractAbi(_StakingEligibilityAbi);

// Token Exchange & Distribution
import _SOFExchangeAbi from '@/contracts/abis/SOFExchange.json';
import _SOFAirdropAbi from '@/contracts/abis/SOFAirdrop.json';
export const SOFExchangeAbi = extractAbi(_SOFExchangeAbi);
export const SOFAirdropAbi = extractAbi(_SOFAirdropAbi);
