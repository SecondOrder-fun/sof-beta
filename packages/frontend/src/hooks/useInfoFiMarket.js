// src/hooks/useInfoFiMarket.js
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { InfoFiMarketFactoryAbi as InfoFiFactoryAbi, InfoFiMarketAbi, ERC20Abi } from '@/utils/abis';

/**
 * Hook for interacting with InfoFi prediction markets
 */
export function useInfoFiMarket(marketId) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  
  const [error, setError] = useState('');
  
  // Query for market details
  const {
    data: marketDetails,
    isLoading: isLoadingMarketDetails,
    refetch: refetchMarketDetails
  } = useQuery({
    queryKey: ['marketDetails', marketId, contracts.INFOFI_FACTORY],
    queryFn: async () => {
      if (!contracts.INFOFI_FACTORY || !marketId) return null;
      
      try {
        // Get market address from factory
        const marketAddress = await publicClient.readContract({
          address: contracts.INFOFI_FACTORY,
          abi: InfoFiFactoryAbi,
          functionName: 'getMarketAddress',
          args: [marketId],
        });
        
        if (!marketAddress || marketAddress === '0x0000000000000000000000000000000000000000') {
          return null;
        }
        
        // Get market details
        const [marketType, playerAddress, probability, isActive, totalLiquidity] = await Promise.all([
          publicClient.readContract({
            address: marketAddress,
            abi: InfoFiMarketAbi,
            functionName: 'marketType',
          }),
          publicClient.readContract({
            address: marketAddress,
            abi: InfoFiMarketAbi,
            functionName: 'player',
          }),
          publicClient.readContract({
            address: marketAddress,
            abi: InfoFiMarketAbi,
            functionName: 'currentProbability',
          }),
          publicClient.readContract({
            address: marketAddress,
            abi: InfoFiMarketAbi,
            functionName: 'isActive',
          }),
          publicClient.readContract({
            address: marketAddress,
            abi: InfoFiMarketAbi,
            functionName: 'totalLiquidity',
          }),
        ]);
        
        return {
          id: marketId,
          address: marketAddress,
          type: marketType,
          player: playerAddress,
          probability: Number(probability) / 100, // Convert basis points to percentage
          isActive,
          totalLiquidity: formatUnits(totalLiquidity, 18)
        };
      } catch {
        return null;
      }
    },
    enabled: Boolean(contracts.INFOFI_FACTORY && marketId),
    staleTime: 30000, // 30 seconds
  });
  
  // Query for user's positions in the market
  const {
    data: userPositions,
    isLoading: isLoadingUserPositions,
    refetch: refetchUserPositions
  } = useQuery({
    queryKey: ['userPositions', address, marketId, marketDetails?.address],
    queryFn: async () => {
      if (!address || !isConnected || !marketDetails?.address) {
        return { yesPosition: '0', noPosition: '0' };
      }
      
      try {
        const [yesPosition, noPosition] = await Promise.all([
          publicClient.readContract({
            address: marketDetails.address,
            abi: InfoFiMarketAbi,
            functionName: 'getPosition',
            args: [address, true], // true for YES position
          }),
          publicClient.readContract({
            address: marketDetails.address,
            abi: InfoFiMarketAbi,
            functionName: 'getPosition',
            args: [address, false], // false for NO position
          }),
        ]);
        
        return {
          yesPosition: formatUnits(yesPosition, 18),
          noPosition: formatUnits(noPosition, 18)
        };
      } catch {
        return { yesPosition: '0', noPosition: '0' };
      }
    },
    enabled: Boolean(address && isConnected && marketDetails?.address),
    staleTime: 30000, // 30 seconds
  });
  
  // Query for market prices
  const {
    data: marketPrices,
    isLoading: isLoadingMarketPrices,
    refetch: refetchMarketPrices
  } = useQuery({
    queryKey: ['marketPrices', marketId, marketDetails?.address],
    queryFn: async () => {
      if (!marketDetails?.address) return { yesPrice: '0', noPrice: '0' };
      
      try {
        const [yesPrice, noPrice] = await Promise.all([
          publicClient.readContract({
            address: marketDetails.address,
            abi: InfoFiMarketAbi,
            functionName: 'getPrice',
            args: [true], // true for YES price
          }),
          publicClient.readContract({
            address: marketDetails.address,
            abi: InfoFiMarketAbi,
            functionName: 'getPrice',
            args: [false], // false for NO price
          }),
        ]);
        
        return {
          yesPrice: formatUnits(yesPrice, 18),
          noPrice: formatUnits(noPrice, 18)
        };
      } catch {
        return { yesPrice: '0', noPrice: '0' };
      }
    },
    enabled: Boolean(marketDetails?.address),
    staleTime: 10000, // 10 seconds (prices change frequently)
  });
  
  // Mutation for placing a bet
  const placeBetMutation = useMutation({
    mutationFn: async ({ outcome, amount }) => {
      if (!isConnected || !walletClient || !marketDetails?.address) {
        throw new Error('Wallet not connected or market not configured');
      }
      
      setError('');
      
      // First approve SOF token transfer to market
      const approveHash = await walletClient.writeContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: 'approve',
        args: [marketDetails.address, parseUnits(amount, 18)],
        account: address,
      });
      
      // Wait for approval transaction to be mined
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      
      // Now place bet
      const hash = await walletClient.writeContract({
        address: marketDetails.address,
        abi: InfoFiMarketAbi,
        functionName: 'placeBet',
        args: [outcome === 'yes', parseUnits(amount, 18)],
        account: address,
      });
      
      // Wait for transaction to be mined
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['userPositions'] });
      queryClient.invalidateQueries({ queryKey: ['marketPrices'] });
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] });
    },
    onError: (err) => {
      setError(err.message || 'Failed to place bet');
    }
  });
  
  // Mutation for claiming winnings
  const claimWinningsMutation = useMutation({
    mutationFn: async () => {
      if (!isConnected || !walletClient || !marketDetails?.address) {
        throw new Error('Wallet not connected or market not configured');
      }
      
      if (!marketDetails.isResolved) {
        throw new Error('Market is not resolved yet');
      }
      
      setError('');
      
      const hash = await walletClient.writeContract({
        address: marketDetails.address,
        abi: InfoFiMarketAbi,
        functionName: 'claimWinnings',
        account: address,
      });
      
      // Wait for transaction to be mined
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['userPositions'] });
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] });
    },
    onError: (err) => {
      setError(err.message || 'Failed to claim winnings');
    }
  });
  
  // Refetch all data
  const refetchAll = () => {
    refetchMarketDetails();
    refetchUserPositions();
    refetchMarketPrices();
  };
  
  return {
    marketDetails,
    userPositions,
    marketPrices,
    isLoading: isLoadingMarketDetails || isLoadingUserPositions || 
               isLoadingMarketPrices || placeBetMutation.isPending || 
               claimWinningsMutation.isPending,
    error,
    placeBet: placeBetMutation.mutate,
    claimWinnings: claimWinningsMutation.mutate,
    refetch: refetchAll
  };
}
