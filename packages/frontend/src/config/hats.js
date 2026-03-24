// src/config/hats.js
// Hats Protocol configuration for Sponsor staking

export const HATS_CONFIG = {
  // Hats Protocol core contract (same on all chains)
  HATS_ADDRESS: "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137",
  
  // StakingEligibility module instance (Base Sepolia)
  STAKING_ELIGIBILITY_ADDRESS: "0x5B36db48B32eAd7F4c5b2C8c6b1a8Ca1a63759C7",
  
  // Hat IDs
  SPONSOR_HAT_ID: BigInt("4906710704797555772930907284579868421939586530586350599955822902509568"),
  
  // Staking requirements
  MIN_STAKE: BigInt("50000000000000000000000"), // 50,000 SOF (18 decimals)
  MIN_STAKE_DISPLAY: "50,000",
  
  // Cooldown period for unstaking (7 days in seconds)
  COOLDOWN_PERIOD: 7 * 24 * 60 * 60,
};

export default HATS_CONFIG;
