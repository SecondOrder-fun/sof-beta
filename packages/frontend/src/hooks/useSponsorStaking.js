// src/hooks/useSponsorStaking.js
import { useAccount, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { HATS_CONFIG } from "@/config/hats";
import { StakingEligibilityAbi, HatsAbi } from "@/utils/abis";

/**
 * Hook for reading sponsor staking status
 * @returns {Object} Staking status and hat ownership info
 */
export function useSponsorStaking() {
  const { address, isConnected } = useAccount();

  // Read multiple values in one call - auto-refresh every 10s
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      // Current stake (returns struct: amount, slashed)
      {
        address: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
        abi: StakingEligibilityAbi,
        functionName: "stakes",
        args: [address],
      },
      // Min stake required
      {
        address: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
        abi: StakingEligibilityAbi,
        functionName: "minStake",
      },
      // Cooldown info (returns struct: amount, endsAt)
      {
        address: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
        abi: StakingEligibilityAbi,
        functionName: "cooldowns",
        args: [address],
      },
      // Is wearer of Sponsor hat
      {
        address: HATS_CONFIG.HATS_ADDRESS,
        abi: HatsAbi,
        functionName: "isWearerOfHat",
        args: [address, HATS_CONFIG.SPONSOR_HAT_ID],
      },
      // Is in good standing
      {
        address: HATS_CONFIG.HATS_ADDRESS,
        abi: HatsAbi,
        functionName: "isInGoodStanding",
        args: [address, HATS_CONFIG.SPONSOR_HAT_ID],
      },
    ],
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Parse results - stakes returns [amount, slashed], cooldowns returns [amount, endsAt]
  const stakeResult = data?.[0]?.result;
  const stakeAmount = stakeResult?.[0] ?? BigInt(0);
  const isSlashed = stakeResult?.[1] ?? false;
  
  const minStake = data?.[1]?.result ?? HATS_CONFIG.MIN_STAKE;
  
  const cooldownResult = data?.[2]?.result;
  const unstakingAmount = cooldownResult?.[0] ?? BigInt(0);
  const unstakeEndsAt = cooldownResult?.[1] ?? BigInt(0);
  
  const isWearingHat = data?.[3]?.result ?? false;
  const isInGoodStanding = data?.[4]?.result ?? false;

  // Derived state
  const hasMinStake = stakeAmount >= minStake;
  const isSponsor = isWearingHat && isInGoodStanding;
  const isUnstaking = unstakingAmount > BigInt(0);
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const canCompleteUnstake = isUnstaking && nowSeconds >= unstakeEndsAt;
  
  // Format for display
  const stakeAmountFormatted = formatUnits(stakeAmount, 18);
  const minStakeFormatted = formatUnits(minStake, 18);
  const unstakingAmountFormatted = formatUnits(unstakingAmount, 18);
  
  // Time until unstake completes (in seconds)
  const unstakeTimeRemaining = unstakeEndsAt > BigInt(0) 
    ? Math.max(0, Number(unstakeEndsAt) - Math.floor(Date.now() / 1000))
    : 0;

  return {
    // Raw values
    stakeAmount,
    minStake,
    unstakingAmount,
    unstakeEndsAt,
    isSlashed,
    
    // Formatted values
    stakeAmountFormatted,
    minStakeFormatted,
    unstakingAmountFormatted,
    
    // Status flags
    isConnected,
    isLoading,
    hasMinStake,
    isSponsor,
    isWearingHat,
    isInGoodStanding,
    isUnstaking,
    canCompleteUnstake,
    unstakeTimeRemaining,
    
    // Actions
    refetch,
  };
}

export default useSponsorStaking;
