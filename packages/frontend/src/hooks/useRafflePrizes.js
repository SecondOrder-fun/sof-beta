import { useReadContract } from "wagmi";
import { useWatchContractLogs } from "@/hooks/chain/useWatchContractLogs";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, createPublicClient, http } from "viem";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import { RafflePrizeDistributorAbi as PrizeDistributorAbi, RaffleAbi } from "@/utils/abis";
import { buildClaimCalls } from "@/services/claimService";
import { useToast } from "@/hooks/useToast";
import { getNetworkByKey } from "@/config/networks";
import { useSmartTransactions } from "./useSmartTransactions";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";

// D11: No backend HTTP endpoint exists for prize distributor data — data lives
// on-chain only. useReadContract is the appropriate abstraction here.
export function useRafflePrizes(seasonId) {
  const netKey = getStoredNetworkKey();
  // SMA-bound read per spec §4.3 — winners are recorded at the SMA.
  const { sma: address } = useRaffleAccount();
  const queryClient = useQueryClient();
  const { executeBatch } = useSmartTransactions();
  const [isWinner, setIsWinner] = useState(false);
  const [claimableAmount, setClaimableAmount] = useState(0n);
  const [claimStatus, setClaimStatus] = useState("unclaimed"); // 'unclaimed', 'claiming', 'completed'
  const { toast } = useToast();

  // Read prizeDistributor address directly from the RAFFLE contract via wagmi.
  // Previously used a separate useQuery wrapping a manual viem read; wagmi's
  // useReadContract is simpler and avoids a redundant client construction.
  const { RAFFLE } = getContractAddresses(netKey);
  const { data: distributorAddress } = useReadContract({
    address: RAFFLE,
    abi: RaffleAbi,
    functionName: "prizeDistributor",
    args: [],
    query: {
      enabled: Boolean(RAFFLE),
      staleTime: Infinity,
    },
  });

  // Read distributor payouts snapshot. No refetchInterval: this data only
  // changes when someone claims, and the GrandClaimed / ConsolationClaimed
  // watchers in this file and in ClaimCenter already invalidate the
  // ["raffle_claims"] cache + drive the UI off the event payload. The
  // previous 5s poll fired two readContract calls every 5 seconds for the
  // lifetime of every Raffle Detail mount — ~24 RPC reads per minute per
  // open tab, which steadily fed Tenderly burst-limit 429s as soon as the
  // page sat idle long enough for another query to fire in the same window.
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
      staleTime: Infinity,
    },
  });

  // Read raffle season details. Same reasoning: status flips on
  // SeasonCompleted / SeasonCancelled, both watched by the listener
  // pipeline that drives SSE invalidation. No reason to bang the chain.
  const { data: raffleDetails } = useReadContract({
    address: RAFFLE,
    abi: RaffleAbi,
    functionName: "getSeasonDetails",
    args: [BigInt(seasonId)],
    query: {
      enabled: Boolean(RAFFLE) && Boolean(seasonId),
      staleTime: Infinity,
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
      const result = await buildClaimCalls({
        type: "raffle-grand",
        params: { seasonId },
        networkKey: netKey,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      const batchId = await executeBatch(result.calls);
      return batchId;
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["raffle_claims"] });
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

  // Watch for the connected user's own GrandClaimed event so we can flip
  // claimStatus to "completed" and show a toast when the chain confirms.
  // Only enabled while a claim is in flight (claimStatus === "claiming") —
  // before the user submits a claim the watcher has nothing to watch for,
  // and polling getLogs on an Active raffle was firing eth_getBlockNumber
  // every 12s for the entire page lifetime, steadily feeding Tenderly
  // burst-limit 429s.
  useWatchContractLogs({
    address: distributorAddress,
    abi: PrizeDistributorAbi,
    eventName: "GrandClaimed",
    onLogs: (logs) => {
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
      distributorAddress && address && seasonId && claimStatus === "claiming"
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
    seasonPayouts,
  };
}
