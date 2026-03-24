// src/utils/abis.js
// Re-exports ABIs from @sof/contracts for backward compatibility.

export {
  RaffleABI as RaffleAbi,
  RafflePositionTrackerABI as RafflePositionTrackerAbi,
  RafflePrizeDistributorABI as RafflePrizeDistributorAbi,
  RaffleTokenABI as RaffleTokenAbi,
  InfoFiMarketABI as InfoFiMarketAbi,
  InfoFiMarketFactoryABI as InfoFiMarketFactoryAbi,
  InfoFiPriceOracleABI as InfoFiPriceOracleAbi,
  InfoFiSettlementABI as InfoFiSettlementAbi,
  RaffleOracleAdapterABI as RaffleOracleAdapterAbi,
  InfoFiFPMMV2ABI as InfoFiFPMMV2Abi,
  SimpleFPMMABI as SimpleFPMMAbi,
  SOLPTokenABI as SOLPTokenAbi,
  ConditionalTokenSOFABI as ConditionalTokensMockAbi,
  SOFBondingCurveABI as SOFBondingCurveAbi,
  SOFTokenABI as SOFTokenAbi,
  SOFFaucetABI as SOFFaucetAbi,
  SeasonFactoryABI as SeasonFactoryAbi,
  ERC20ABI as ERC20Abi,
  AccessControlABI as AccessControlAbi,
  HatsABI as HatsAbi,
  StakingEligibilityABI as StakingEligibilityAbi,
  SOFExchangeABI as SOFExchangeAbi,
  SOFAirdropABI as SOFAirdropAbi,
} from '@sof/contracts';

// Minimal ERC-721 ABI for approve calls (not in Foundry build)
export const ERC721ApproveAbi = [
  { name: "approve", type: "function", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
];
