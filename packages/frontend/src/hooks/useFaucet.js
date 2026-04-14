// src/hooks/useFaucet.js
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { formatUnits, encodeFunctionData } from "viem";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { SOFFaucetAbi, ERC20Abi } from "@/utils/abis";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";

/**
 * Hook for interacting with the SOF Faucet contract
 */
export function useFaucet() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { executeBatch } = useSmartTransactions();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  const [error, setError] = useState("");

  // Query for SOF balance
  const {
    data: sofBalance = "0",
    isLoading: isLoadingBalance,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ["sofBalance", address, contracts.SOF],
    queryFn: async () => {
      if (!address || !isConnected || !contracts.SOF) return "0";

      try {
        const balance = await publicClient.readContract({
          address: contracts.SOF,
          abi: ERC20Abi,
          functionName: "balanceOf",
          args: [address],
        });

        return formatUnits(balance, 18);
      } catch (err) {
        // Silent error handling, returning default value
        return "0";
      }
    },
    enabled: Boolean(address && isConnected && contracts.SOF),
    staleTime: 15000, // 15 seconds
  });

  // Query for faucet balance
  const {
    data: faucetBalance = "0",
    isLoading: isLoadingFaucetBalance,
  } = useQuery({
    queryKey: ["faucetBalance", contracts.SOF_FAUCET, contracts.SOF],
    queryFn: async () => {
      if (!contracts.SOF_FAUCET || !contracts.SOF) return "0";

      try {
        const balance = await publicClient.readContract({
          address: contracts.SOF,
          abi: ERC20Abi,
          functionName: "balanceOf",
          args: [contracts.SOF_FAUCET],
        });

        return formatUnits(balance, 18);
      } catch (err) {
        // Silent error handling, returning default value
        return "0";
      }
    },
    enabled: Boolean(contracts.SOF_FAUCET && contracts.SOF),
    staleTime: 15000, // 15 seconds
  });

  // Query for faucet data with robust validation
  const {
    data: faucetData,
    isLoading: isLoadingFaucet,
    refetch: refetchFaucet,
    error: faucetError,
  } = useQuery({
    queryKey: ["faucetData", address, contracts.SOF_FAUCET],
    queryFn: async () => {
      if (!address || !isConnected) return null;
      
      // Validate faucet address exists
      if (!contracts.SOF_FAUCET || contracts.SOF_FAUCET === "") {
        return null;
      }

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(contracts.SOF_FAUCET)) {
        return null;
      }

      try {
        // CRITICAL: Check if contract is deployed at this address
        const code = await publicClient.getBytecode({
          address: contracts.SOF_FAUCET,
        });

        if (!code || code === "0x" || code === "0x0") {
          return null;
        }

        // Contract exists, proceed with reads
        const [lastClaimTime, cooldownPeriod, amountPerRequest] =
          await Promise.all([
            publicClient.readContract({
              address: contracts.SOF_FAUCET,
              abi: SOFFaucetAbi,
              functionName: "lastClaimTime",
              args: [address],
            }),
            publicClient.readContract({
              address: contracts.SOF_FAUCET,
              abi: SOFFaucetAbi,
              functionName: "cooldownPeriod",
            }),
            publicClient.readContract({
              address: contracts.SOF_FAUCET,
              abi: SOFFaucetAbi,
              functionName: "amountPerRequest",
            }),
          ]);

        return {
          lastClaimTime: Number(lastClaimTime),
          cooldownPeriod: Number(cooldownPeriod),
          amountPerRequest: formatUnits(amountPerRequest, 18),
          canClaim:
            Number(lastClaimTime) === 0 ||
            Date.now() / 1000 > Number(lastClaimTime) + Number(cooldownPeriod),
        };
      } catch {
        return null;
      }
    },
    enabled: Boolean(address && isConnected && contracts.SOF_FAUCET),
    staleTime: 15000, // 15 seconds
    retry: false, // Don't retry on failure - it won't help
  });

  // Mutation for claiming tokens
  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!isConnected || !contracts.SOF_FAUCET) {
        throw new Error("Wallet not connected or faucet not configured");
      }

      setError("");

      const hash = await executeBatch([{
        to: contracts.SOF_FAUCET,
        data: encodeFunctionData({
          abi: SOFFaucetAbi,
          functionName: "claim",
          args: [],
        }),
      }], { sofAmount: 0n });

      return { hash };
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
      queryClient.invalidateQueries({ queryKey: ["faucetData"] });
    },
    onError: (err) => {
      setError(err.message || "Failed to claim tokens");
    },
  });

  // Mutation for contributing karma (returning tokens to the faucet)
  const karmaMutation = useMutation({
    mutationFn: async (amount) => {
      if (
        !isConnected ||
        !contracts.SOF_FAUCET ||
        !contracts.SOF
      ) {
        throw new Error("Wallet not connected or faucet not configured");
      }

      if (!amount || parseFloat(amount) <= 0) {
        throw new Error("Amount must be greater than 0");
      }

      setError("");

      const parsedAmount = BigInt(parseFloat(amount) * 10 ** 18);

      // Batch approve + contributeKarma in a single executeBatch call
      const hash = await executeBatch([
        {
          to: contracts.SOF,
          data: encodeFunctionData({
            abi: ERC20Abi,
            functionName: "approve",
            args: [contracts.SOF_FAUCET, parsedAmount],
          }),
        },
        {
          to: contracts.SOF_FAUCET,
          data: encodeFunctionData({
            abi: SOFFaucetAbi,
            functionName: "contributeKarma",
            args: [parsedAmount],
          }),
        },
      ], { sofAmount: parsedAmount });

      return { hash };
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
      queryClient.invalidateQueries({ queryKey: ["faucetBalance"] });
      queryClient.invalidateQueries({ queryKey: ["faucetData"] });
    },
    onError: (err) => {
      setError(err.message || "Failed to contribute karma");
    },
  });

  // Listen for KarmaReceived events to update faucet balance and user balance in real-time
  useEffect(() => {
    if (!publicClient || !contracts.SOF_FAUCET) return;

    // Set up event listener for KarmaReceived events
    const unwatch = publicClient.watchContractEvent({
      address: contracts.SOF_FAUCET,
      abi: SOFFaucetAbi,
      eventName: "KarmaReceived",
      onLogs: () => {
        // Refetch both faucet balance and user balance when karma is received
        queryClient.invalidateQueries({ queryKey: ["faucetBalance"] });
        queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
      },
    });

    // Clean up listener on unmount
    return () => {
      if (unwatch) unwatch();
    };
  }, [publicClient, contracts.SOF_FAUCET, queryClient]);

  // Calculate time remaining until next claim
  const getTimeRemaining = () => {
    if (!faucetData) return "";

    const { lastClaimTime, cooldownPeriod } = faucetData;
    if (lastClaimTime === 0) return "";

    const now = Math.floor(Date.now() / 1000);
    const nextClaimTime = lastClaimTime + cooldownPeriod;
    const remaining = nextClaimTime - now;

    if (remaining <= 0) return "";

    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;

    return `${hours}h ${minutes}m ${seconds}s`;
  };

  return {
    sofBalance,
    faucetBalance,
    faucetData,
    isLoading:
      isLoadingBalance ||
      isLoadingFaucet ||
      isLoadingFaucetBalance ||
      claimMutation.isPending ||
      karmaMutation.isPending,
    error,
    claim: claimMutation.mutate,
    contributeKarma: karmaMutation.mutate,
    refetch: () => {
      refetchBalance();
      refetchFaucet();
    },
    getTimeRemaining,
    isClaimable: faucetData?.canClaim || false,
    faucetError,
    faucetAddress: contracts.SOF_FAUCET,
  };
}
