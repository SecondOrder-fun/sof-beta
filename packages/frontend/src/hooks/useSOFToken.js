// src/hooks/useSOFToken.js
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { ERC20Abi } from '@/utils/abis';

/**
 * Hook for interacting with the SOF token contract
 */
export function useSOFToken() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  
  const [error, setError] = useState('');
  
  // Query for SOF balance
  const { 
    data: balance = '0',
    isLoading: isLoadingBalance,
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
    enabled: Boolean(address && isConnected && contracts.SOF),
    staleTime: 15000, // 15 seconds
  });
  
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
      if (!isConnected || !walletClient || !contracts.SOF) {
        throw new Error('Wallet not connected or token not configured');
      }
      
      if (!to || !amount) {
        throw new Error('Recipient address and amount are required');
      }
      
      setError('');
      
      const decimals = tokenDetails?.decimals || 18;
      const parsedAmount = parseUnits(amount, decimals);
      
      const hash = await walletClient.writeContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: 'transfer',
        args: [to, parsedAmount],
        account: address,
      });
      
      // Wait for transaction to be mined
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
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
      if (!isConnected || !walletClient || !contracts.SOF) {
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
      
      const hash = await walletClient.writeContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: 'approve',
        args: [spender, parsedAmount],
        account: address,
      });
      
      // Wait for transaction to be mined
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
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
    isLoading: isLoadingBalance || isLoadingDetails || 
               transferMutation.isPending || approveMutation.isPending,
    error,
    transfer: transferMutation.mutate,
    approve: approveMutation.mutate,
    getAllowance,
    refetchBalance
  };
}
