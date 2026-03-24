import { useReadContract, useAccount, useWatchContractEvent } from "wagmi";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatEther } from "viem";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import { RafflePrizeDistributorAbi as PrizeDistributorAbi, RaffleAbi } from "@/utils/abis";
import { getPrizeDistributor } from "@/services/onchainRaffleDistributor";
import { executeClaim } from "@/services/claimService";
import { useToast } from "@/hooks/useToast";
import { createPublicClient, http } from "viem";
import { getNetworkByKey } from "@/config/networks";

export function useRafflePrizes(seasonId) {
  const netKey = getStoredNetworkKey();
  // Using on-chain distributor discovery; no direct RAFFLE usage here.
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [isWinner, setIsWinner] = useState(false);
  const [claimableAmount, setClaimableAmount] = useState(0n);
  const [claimStatus, setClaimStatus] = useState("unclaimed"); // 'unclaimed', 'claiming', 'completed'
  const { toast } = useToast();

  const distributorQuery = useQuery({
    queryKey: ["prize_distributor_addr", netKey],
    queryFn: () => getPrizeDistributor({ networkKey: netKey }),
    staleTime: 10_000,
  });

  // On-chain fallback: read prizeDistributor() from configured RAFFLE if service is unavailable
  const { RAFFLE } = getContractAddresses(netKey);
  const { data: distributorFromChain } = useReadContract({
    address: distributorQuery.data ? undefined : RAFFLE,
    abi: RaffleAbi,
    functionName: "prizeDistributor",
    args: [],
    query: {
      enabled: !distributorQuery.data && Boolean(RAFFLE),
    },
  });

  const distributorAddress = distributorQuery.data || distributorFromChain;

  // Read distributor payouts snapshot
  const { data: seasonPayouts, isLoading: isLoadingPayouts } = useReadContract({
    address: distributorAddress,
    abi: PrizeDistributorAbi,
    functionName: "getSeason",
    args: [BigInt(seasonId)],
    query: {
      enabled:
        !!seasonId &&
        !!distributorAddress &&
        distributorAddress !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 5000, // Poll for updates
    },
  });

  // Read raffle season details to compare status/winner against distributor snapshot
  const { data: raffleDetails } = useReadContract({
    address: RAFFLE,
    abi: RaffleAbi,
    functionName: "getSeasonDetails",
    args: [BigInt(seasonId)],
    query: {
      enabled: Boolean(RAFFLE) && Boolean(seasonId),
      refetchInterval: 5000,
    },
  });

  useEffect(() => {
    async function checkWinnerAndConsolation() {
      if (isLoadingPayouts || !seasonPayouts || !address) return;

      const grandWinner = seasonPayouts.grandWinner;
      if (grandWinner.toLowerCase() === address.toLowerCase()) {
        setIsWinner(true);
        setClaimableAmount(seasonPayouts.grandAmount || 0n);
      }
    }

    checkWinnerAndConsolation();
  }, [address, seasonId, seasonPayouts, isLoadingPayouts]);

  // Mutation for claiming grand prize
  const claimGrandMutation = useMutation({
    mutationFn: async () => {
      if (!distributorAddress || !address) {
        throw new Error("Distributor address or account not available");
      }

      setClaimStatus("claiming");
      const result = await executeClaim({
        type: "raffle-grand",
        params: { seasonId },
        networkKey: netKey,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.hash;
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["raffle_claims"] });
      queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
    },
    onError: (error) => {
      setClaimStatus("unclaimed");
      toast({
        title: "Claim Failed",
        description: error.message || "Failed to claim prize",
        variant: "destructive",
      });
    },
  });

  const {
    data: claimHash,
    isPending: isClaiming,
    isSuccess: isClaimed,
  } = claimGrandMutation;

  // Update claim status when mutation succeeds
  useEffect(() => {
    if (isClaimed) {
      setClaimStatus("completed");
    }
  }, [isClaimed]);

  // Recover historical claim tx hash for already-completed prizes
  const historicalClaimTxQuery = useQuery({
    queryKey: ["grandClaimTx", netKey, distributorAddress, seasonId, address],
    enabled: Boolean(
      distributorAddress &&
        address &&
        seasonId &&
        claimStatus === "completed" &&
        !claimHash
    ),
    queryFn: async () => {
      const net = getNetworkByKey(netKey);
      if (!net?.rpcUrl) return null;

      const client = createPublicClient({
        chain: {
          id: net.id,
          name: net.name,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [net.rpcUrl] } },
        },
        transport: http(net.rpcUrl),
      });

      const logs = await client.getLogs({
        address: distributorAddress,
        event: {
          type: "event",
          name: "GrandClaimed",
          inputs: [
            { indexed: true, name: "seasonId", type: "uint256" },
            { indexed: true, name: "winner", type: "address" },
            { indexed: false, name: "amount", type: "uint256" },
          ],
        },
        args: { seasonId: BigInt(seasonId), winner: address },
        fromBlock: 0n,
        toBlock: "latest",
      });

      if (!logs || logs.length === 0) return null;
      const last = logs[logs.length - 1];
      return last.transactionHash || null;
    },
    staleTime: 60_000,
  });

  // Watch for GrandClaimed events
  useWatchContractEvent({
    address: distributorAddress,
    abi: PrizeDistributorAbi,
    eventName: "GrandClaimed",
    onLogs: (logs) => {
      // Check if this event is for our season and address
      logs.forEach((log) => {
        if (
          log.args &&
          log.args.seasonId &&
          BigInt(log.args.seasonId) === BigInt(seasonId) &&
          log.args.winner &&
          log.args.winner.toLowerCase() === address?.toLowerCase()
        ) {
          setClaimStatus("completed");
          toast({
            title: "Prize Claimed!",
            description: `You've successfully claimed ${formatEther(
              log.args.amount
            )} SOF!`,
            variant: "success",
          });
        }
      });
    },
    enabled: Boolean(
      distributorAddress && address && seasonId && claimStatus !== "completed"
    ),
  });

  const handleClaimGrandPrize = () => {
    claimGrandMutation.mutate();
  };

  // Check if the prize has already been claimed when the component mounts or seasonPayouts changes
  useEffect(() => {
    if (seasonPayouts?.grandClaimed) {
      setClaimStatus("completed");
    }
  }, [seasonPayouts]);

  return {
    isWinner,
    claimableAmount: formatEther(claimableAmount),
    isLoading: isLoadingPayouts,
    isConfirming: isClaiming || claimStatus === "claiming",
    isConfirmed: isClaimed || claimStatus === "completed",
    handleClaimGrandPrize,
    distributorAddress,
    hasDistributor: Boolean(
      distributorAddress &&
        distributorAddress !== "0x0000000000000000000000000000000000000000"
    ),
    grandWinner: seasonPayouts?.grandWinner,
    funded: Boolean(seasonPayouts?.funded),
    raffleWinner: Array.isArray(raffleDetails)
      ? raffleDetails[3]
      : raffleDetails?.winner,
    raffleStatus: Array.isArray(raffleDetails)
      ? Number(raffleDetails[1])
      : raffleDetails?.status,
    claimStatus,
    claimTxHash: claimHash || historicalClaimTxQuery.data,
  };
}
