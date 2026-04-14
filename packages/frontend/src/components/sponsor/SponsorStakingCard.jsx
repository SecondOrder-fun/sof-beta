// src/components/sponsor/SponsorStakingCard.jsx
import { useState } from "react";
import { useAccount, useWatchContractEvent } from "wagmi";
import { encodeFunctionData } from "viem";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSponsorStaking } from "@/hooks/useSponsorStaking";
import { useSOFBalance } from "@/hooks/useSOFBalance";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { HATS_CONFIG } from "@/config/hats";
import { getContractAddresses } from "@/config/contracts";
import { StakingEligibilityAbi } from "@/utils/abis";
import { useTranslation } from "react-i18next";
import { Crown, Loader2, Check, Clock, AlertTriangle, RefreshCw } from "lucide-react";

// ERC20 ABI for approve
const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
];

// Hats mintHat ABI
const HATS_MINT_ABI = [
  {
    type: "function",
    name: "mintHat",
    inputs: [
      { name: "_hatId", type: "uint256" },
      { name: "_wearer", type: "address" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
];

function formatTimeRemaining(seconds, readyLabel) {
  if (seconds <= 0) return readyLabel || "Ready";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function SponsorStakingCard() {
  const { t } = useTranslation("raffle");
  const { address, isConnected } = useAccount();
  const network = (import.meta.env.VITE_NETWORK || "TESTNET").toUpperCase();
  const sofAddress = getContractAddresses(network).SOF;
  
  const {
    stakeAmount,
    minStake,
    stakeAmountFormatted,
    isSponsor,
    isWearingHat,
    hasMinStake,
    isSlashed,
    isUnstaking,
    canCompleteUnstake,
    unstakeTimeRemaining,
    unstakingAmountFormatted,
    isLoading: isStatusLoading,
    refetch,
  } = useSponsorStaking();

  const { balance: sofBalance, isLoading: isBalanceLoading } = useSOFBalance();
  
  // Steps: idle → approving → staking → minting → unstaking → completing
  const [step, setStep] = useState("idle");
  const { executeBatch } = useSmartTransactions();

  // Watch for staking events to auto-refresh
  useWatchContractEvent({
    address: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
    abi: StakingEligibilityAbi,
    eventName: "StakingEligibility_Staked",
    onLogs: (logs) => {
      if (logs.some(log => log.args?.staker?.toLowerCase() === address?.toLowerCase())) {
        refetch();
      }
    },
    enabled: isConnected && !!address,
  });

  useWatchContractEvent({
    address: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
    abi: StakingEligibilityAbi,
    eventName: "StakingEligibility_UnstakeBegun",
    onLogs: (logs) => {
      if (logs.some(log => log.args?.staker?.toLowerCase() === address?.toLowerCase())) {
        refetch();
      }
    },
    enabled: isConnected && !!address,
  });

  // Become sponsor: approve + stake + mintHat batched in one ERC-5792 call
  const handleBecomeSponsor = async () => {
    if (!sofAddress || !address) return;
    try {
      setStep("approving");
      await executeBatch([
        {
          to: sofAddress,
          data: encodeFunctionData({
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS, minStake],
          }),
        },
        {
          to: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
          data: encodeFunctionData({
            abi: StakingEligibilityAbi,
            functionName: "stake",
            args: [minStake],
          }),
        },
        {
          to: HATS_CONFIG.HATS_ADDRESS,
          data: encodeFunctionData({
            abi: HATS_MINT_ABI,
            functionName: "mintHat",
            args: [HATS_CONFIG.SPONSOR_HAT_ID, address],
          }),
        },
      ], { sofAmount: minStake });
      refetch();
    } finally {
      setStep("idle");
    }
  };

  // For users who staked but don't have the hat yet
  const handleClaimHat = async () => {
    if (!address) return;
    try {
      setStep("minting");
      await executeBatch([
        {
          to: HATS_CONFIG.HATS_ADDRESS,
          data: encodeFunctionData({
            abi: HATS_MINT_ABI,
            functionName: "mintHat",
            args: [HATS_CONFIG.SPONSOR_HAT_ID, address],
          }),
        },
      ], { sofAmount: 0n });
      refetch();
    } finally {
      setStep("idle");
    }
  };

  const handleBeginUnstake = async () => {
    try {
      setStep("unstaking");
      await executeBatch([
        {
          to: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
          data: encodeFunctionData({
            abi: StakingEligibilityAbi,
            functionName: "beginUnstake",
            args: [stakeAmount],
          }),
        },
      ], { sofAmount: 0n });
      refetch();
    } finally {
      setStep("idle");
    }
  };

  const handleCompleteUnstake = async () => {
    try {
      setStep("completing");
      await executeBatch([
        {
          to: HATS_CONFIG.STAKING_ELIGIBILITY_ADDRESS,
          data: encodeFunctionData({
            abi: StakingEligibilityAbi,
            functionName: "completeUnstake",
            args: [address],
          }),
        },
      ], { sofAmount: 0n });
      refetch();
    } finally {
      setStep("idle");
    }
  };

  const isProcessing = step !== "idle";

  const hasEnoughSOF = sofBalance >= minStake;
  
  // User has staked enough but hasn't claimed hat yet
  const needsHatClaim = hasMinStake && !isWearingHat && !isUnstaking;

  // Get step label for button
  const getStepLabel = () => {
    switch (step) {
      case "approving": return t("approving");
      case "staking": return t("stakingProgress");
      case "minting": return t("claimingSponsorHat");
      default: return null;
    }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            {t("becomeSponsorTitle")}
          </CardTitle>
          <CardDescription>{t("connectToStake")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            {t("sponsorStatus")}
          </CardTitle>
          {isSponsor ? (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
              <Check className="h-3 w-3 mr-1" />
              {t("activeSponsor")}
            </Badge>
          ) : isUnstaking ? (
            <Badge variant="outline" className="border-yellow-500/30 text-yellow-400">
              <Clock className="h-3 w-3 mr-1" />
              {t("unstakingStatus")}
            </Badge>
          ) : needsHatClaim ? (
            <Badge variant="outline" className="border-blue-500/30 text-blue-400">
              {t("claimHat")}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-muted-foreground/30">
              {t("notASponsor")}
            </Badge>
          )}
        </div>
        <CardDescription>
          {t("stakeToCreate", { amount: HATS_CONFIG.MIN_STAKE_DISPLAY })}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current Stake */}
        <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
          <span className="text-sm text-muted-foreground">{t("yourStake")}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">
              {isStatusLoading ? "..." : Number(stakeAmountFormatted).toLocaleString()} $SOF
            </span>
            <Button
              variant="default"
              size="icon"
              onClick={() => refetch()}
              disabled={isStatusLoading}
              className="h-6 w-6"
              title="Refresh"
            >
              <RefreshCw className={`h-3 w-3 ${isStatusLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Unstaking Status */}
        {isUnstaking && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-yellow-400">{t("unstakingAmount")}</span>
              <span className="font-mono text-yellow-400">
                {Number(unstakingAmountFormatted).toLocaleString()} $SOF
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-yellow-400">{t("timeRemaining")}</span>
              <span className="font-mono text-yellow-400">
                {formatTimeRemaining(unstakeTimeRemaining, t("ready"))}
              </span>
            </div>
          </div>
        )}

        {/* Slashing Warning */}
        {isSlashed && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{t("accountSlashed")}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {/* New user: needs to stake */}
          {!isSponsor && !isUnstaking && !needsHatClaim && (
            <>
              {!hasEnoughSOF ? (
                <div className="text-sm text-muted-foreground text-center py-2">
                  {t("needSofToSponsor", { amount: HATS_CONFIG.MIN_STAKE_DISPLAY })}
                  <br />
                  {t("currentBalanceLabel", { balance: isBalanceLoading ? "..." : Number(sofBalance / BigInt(10**18)).toLocaleString() })}
                </div>
              ) : (
                <Button 
                  onClick={handleBecomeSponsor} 
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {getStepLabel()}
                    </>
                  ) : (
                    <>
                      <Crown className="h-4 w-4 mr-2" />
                      {t("becomeRaffleSponsor")}
                    </>
                  )}
                </Button>
              )}
            </>
          )}

          {/* Staked but no hat: needs to claim */}
          {needsHatClaim && (
            <Button
              onClick={handleClaimHat}
              disabled={isProcessing}
              className="w-full"
            >
              {step === "minting" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("claimingSponsorHat")}
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4 mr-2" />
                  {t("claimSponsorHat")}
                </>
              )}
            </Button>
          )}

          {/* Has stake (sponsor or not): can unstake */}
          {stakeAmount > 0n && !isUnstaking && (
            <Button 
              variant="outline" 
              onClick={handleBeginUnstake}
              disabled={isProcessing}
              className="w-full"
            >
              {step === "unstaking" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("processing")}
                </>
              ) : (
                t("beginUnstake")
              )}
            </Button>
          )}

          {/* Unstaking complete: can withdraw */}
          {isUnstaking && canCompleteUnstake && (
            <Button 
              onClick={handleCompleteUnstake}
              disabled={isProcessing}
              className="w-full"
            >
              {step === "completing" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("processing")}
                </>
              ) : (
                t("completeUnstake")
              )}
            </Button>
          )}
        </div>

        {/* Info */}
        <p className="text-xs text-muted-foreground text-center">
          {t("sponsorInfoText")}
        </p>
      </CardContent>
    </Card>
  );
}

export default SponsorStakingCard;
