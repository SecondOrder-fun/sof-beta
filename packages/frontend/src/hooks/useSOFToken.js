// src/hooks/useSOFToken.js
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits, encodeFunctionData } from 'viem';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { ERC20Abi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { useRaffleAccount } from '@/hooks/useRaffleAccount';

/**
 * Hook for interacting with the SOF token contract.
 *
 * Reads (balance, allowance) resolve at the SMA per spec §4.3.
 */
export function useSOFToken() {
  const { isConnected } = useAccount();
  // Reads against the smart account; writes still originate from the
  // connected wallet via executeBatch.
  const { sma: address, isReady: accountReady } = useRaffleAccount();
  const publicClient = usePublicClient();
  const { executeBatch } = useSmartTransactions();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  const [error, setError] = useState('');

  // Query for SOF balance.
  // Important: the balance query is disabled until the RaffleAccountProvider
  // resolves the user's SMA address. While disabled, react-query reports
  // `isLoading: false` (it's not loading, it's *not started*) — which
  // collapses with "balance is 0" in downstream consumers and gates the buy
  // button to disabled. We expose a separate `isLoading` below that returns
  // true until the SMA is known AND the balance query has run, so consumers
  // can tell pending from zero.
  const balanceEnabled = Boolean(address && isConnected && contracts.SOF && accountReady);
  const {
    data: balance = '0',
    isFetching: isFetchingBalance,
    isSuccess: balanceFetched,
    refetch: refetchBalance
  } = useQuery({
    queryKey: ['sofBalance', address, contracts.SOF],
    queryFn: async () => {
      if (!address || !isConnected || !contracts.SOF) return '0';

      try {
        const balance = await publicClient.readContract({
          address: contracts.SOF,
          abi: ERC20Abi,
          functionName: 'balanceOf',
          args: [address],
        });

        return formatUnits(balance, 18);
      } catch {
        return '0';
      }
    },
    enabled: balanceEnabled,
    staleTime: 15000, // 15 seconds
  });
  // True until both the account provider resolves AND the balance query runs.
  // Consumers (e.g. useBalanceValidation in the buy/sell widget) MUST gate
  // their `hasZeroBalance` checks on this — otherwise the button shows
  // "insufficient balance" while the SMA query is still pending.
  const balancePending = !accountReady || (balanceEnabled && !balanceFetched);
  
  // Query for token details
  const {
    data: tokenDetails,
    isLoading: isLoadingDetails
  } = useQuery({
    queryKey: ['sofTokenDetails', contracts.SOF],
    queryFn: async () => {
      if (!contracts.SOF) return null;
      
      try {
        const [name, symbol, totalSupply, decimals] = await Promise.all([
          publicClient.readContract({
            address: contracts.SOF,
            abi: ERC20Abi,
            functionName: 'name',
          }),
          publicClient.readContract({
            address: contracts.SOF,
            abi: ERC20Abi,
            functionName: 'symbol',
          }),
          publicClient.readContract({
            address: contracts.SOF,
            abi: ERC20Abi,
            functionName: 'totalSupply',
          }),
          publicClient.readContract({
            address: contracts.SOF,
            abi: ERC20Abi,
            functionName: 'decimals',
          })
        ]);
        
        return {
          name,
          symbol,
          totalSupply: formatUnits(totalSupply, decimals),
          decimals: Number(decimals)
        };
      } catch {
        return null;
      }
    },
    enabled: Boolean(contracts.SOF),
    staleTime: 60 * 60 * 1000, // 1 hour
  });
  
  // Mutation for token transfer
  const transferMutation = useMutation({
    mutationFn: async ({ to, amount }) => {
      if (!isConnected || !contracts.SOF) {
        throw new Error('Wallet not connected or token not configured');
      }

      if (!to || !amount) {
        throw new Error('Recipient address and amount are required');
      }

      setError('');

      const decimals = tokenDetails?.decimals || 18;
      const parsedAmount = parseUnits(amount, decimals);

      const hash = await executeBatch([{
        to: contracts.SOF,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'transfer',
          args: [to, parsedAmount],
        }),
      }], { sofAmount: parsedAmount });

      return { hash };
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] });
    },
    onError: (err) => {
      setError(err.message || 'Failed to transfer tokens');
    }
  });
  
  // Mutation for token approval
  const approveMutation = useMutation({
    mutationFn: async ({ spender, amount }) => {
      if (!isConnected || !contracts.SOF) {
        throw new Error('Wallet not connected or token not configured');
      }

      if (!spender) {
        throw new Error('Spender address is required');
      }

      setError('');

      const decimals = tokenDetails?.decimals || 18;
      const parsedAmount = amount === 'max'
        ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        : parseUnits(amount, decimals);

      const hash = await executeBatch([{
        to: contracts.SOF,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'approve',
          args: [spender, parsedAmount],
        }),
      }], { sofAmount: 0n });

      return { hash };
    },
    onError: (err) => {
      setError(err.message || 'Failed to approve tokens');
    }
  });
  
  // Query for allowance
  const getAllowance = async (spender) => {
    if (!address || !isConnected || !contracts.SOF || !spender) {
      return '0';
    }
    
    try {
      const allowance = await publicClient.readContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: 'allowance',
        args: [address, spender],
      });
      
      const decimals = tokenDetails?.decimals || 18;
      return formatUnits(allowance, decimals);
    } catch {
      return '0';
    }
  };
  
  return {
    balance,
    tokenDetails,
    // `isLoading` collapses balance-fetching, account-resolution, details, and
    // mutation states. Consumers that care specifically about "is the SMA
    // balance read settled?" should use `balancePending`.
    isLoading: balancePending || isFetchingBalance || isLoadingDetails ||
               transferMutation.isPending || approveMutation.isPending,
    balancePending,
    error,
    transfer: transferMutation.mutate,
    approve: approveMutation.mutate,
    getAllowance,
    refetchBalance
  };
}
