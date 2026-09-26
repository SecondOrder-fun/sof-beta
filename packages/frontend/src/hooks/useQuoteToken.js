// src/hooks/useQuoteToken.js
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits, encodeFunctionData } from 'viem';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { ERC20Abi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { useRaffleAccount } from '@/hooks/useRaffleAccount';

/**
 * Hook for interacting with a quote token contract.
 *
 * Seasons are priced in a per-season quote token, so season-scoped callers
 * should pass that season's token (see useSeasonQuoteToken). Callers that are
 * not season-scoped fall back to the platform-level placeholder quote token.
 *
 * Reads (balance, allowance) resolve at the SMA per spec §4.3.
 *
 * @param {`0x${string}` | undefined} [tokenAddress] Token to operate on.
 *   Defaults to the platform quote token.
 */
export function useQuoteToken(tokenAddress) {
  const { isConnected } = useAccount();
  // Reads against the smart account; writes still originate from the
  // connected wallet via executeBatch.
  const { sma: address, isReady: accountReady } = useRaffleAccount();
  const publicClient = usePublicClient();
  const { executeBatch } = useSmartTransactions();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const token = tokenAddress || contracts.QUOTE_TOKEN;

  const [error, setError] = useState('');

  // Query for the quote-token balance.
  // Important: the balance query is disabled until the RaffleAccountProvider
  // resolves the user's SMA address. While disabled, react-query reports
  // `isLoading: false` (it's not loading, it's *not started*) — which
  // collapses with "balance is 0" in downstream consumers and gates the buy
  // button to disabled. We expose a separate `isLoading` below that returns
  // true until the SMA is known AND the balance query has run, so consumers
  // can tell pending from zero.
  const balanceEnabled = Boolean(address && isConnected && token && accountReady);
  const {
    data: balance = '0',
    isFetching: isFetchingBalance,
    isSuccess: balanceFetched,
    refetch: refetchBalance
  } = useQuery({
    queryKey: ['quoteBalance', address, token],
    queryFn: async () => {
      if (!address || !isConnected || !token) return '0';

      try {
        const balance = await publicClient.readContract({
          address: token,
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
    queryKey: ['quoteTokenDetails', token],
    queryFn: async () => {
      if (!token) return null;
      
      try {
        const [name, symbol, totalSupply, decimals] = await Promise.all([
          publicClient.readContract({
            address: token,
            abi: ERC20Abi,
            functionName: 'name',
          }),
          publicClient.readContract({
            address: token,
            abi: ERC20Abi,
            functionName: 'symbol',
          }),
          publicClient.readContract({
            address: token,
            abi: ERC20Abi,
            functionName: 'totalSupply',
          }),
          publicClient.readContract({
            address: token,
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
    enabled: Boolean(token),
    staleTime: 60 * 60 * 1000, // 1 hour
  });
  
  // Mutation for token transfer
  const transferMutation = useMutation({
    mutationFn: async ({ to, amount }) => {
      if (!isConnected || !token) {
        throw new Error('Wallet not connected or token not configured');
      }

      if (!to || !amount) {
        throw new Error('Recipient address and amount are required');
      }

      setError('');

      const decimals = tokenDetails?.decimals || 18;
      const parsedAmount = parseUnits(amount, decimals);

      const hash = await executeBatch([{
        to: token,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'transfer',
          args: [to, parsedAmount],
        }),
      }], { sofAmount: parsedAmount });

      return { hash };
    },
    onError: (err) => {
      setError(err.message || 'Failed to transfer tokens');
    }
  });
  
  // Mutation for token approval
  const approveMutation = useMutation({
    mutationFn: async ({ spender, amount }) => {
      if (!isConnected || !token) {
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
        to: token,
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
    if (!address || !isConnected || !token || !spender) {
      return '0';
    }
    
    try {
      const allowance = await publicClient.readContract({
        address: token,
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
