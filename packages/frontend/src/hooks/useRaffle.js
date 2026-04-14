// src/hooks/useRaffle.js
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { encodeFunctionData } from 'viem';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { RaffleAbi, ERC20Abi, SOFBondingCurveAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';

// Create aliases for consistency with code usage
const CurveAbi = SOFBondingCurveAbi;

/**
 * Hook for interacting with the Raffle contract
 */
export function useRaffle(seasonId) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const { executeBatch } = useSmartTransactions();
  
  const [error, setError] = useState('');
  
  // Query for season details
  const {
    data: seasonDetails,
    isLoading: isLoadingSeasonDetails,
    refetch: refetchSeasonDetails
  } = useQuery({
    queryKey: ['seasonDetails', seasonId, contracts.RAFFLE],
    queryFn: async () => {
      if (!contracts.RAFFLE || !seasonId) return null;
      
      try {
        const season = await publicClient.readContract({
          address: contracts.RAFFLE,
          abi: RaffleAbi,
          functionName: 'seasons',
          args: [seasonId],
        });
        
        // Get curve address from season
        const curveAddress = season.curve;
        
        // Get additional details
        const [startTime, endTime, state, winnerCount] = await Promise.all([
          publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RaffleAbi,
            functionName: 'getSeasonStartTime',
            args: [seasonId],
          }),
          publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RaffleAbi,
            functionName: 'getSeasonEndTime',
            args: [seasonId],
          }),
          publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RaffleAbi,
            functionName: 'getSeasonState',
            args: [seasonId],
          }),
          publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RaffleAbi,
            functionName: 'getSeasonWinnerCount',
            args: [seasonId],
          }),
        ]);
        
        // Map state to human-readable value
        const stateMap = {
          0: 'PENDING',
          1: 'ACTIVE',
          2: 'ENDED',
          3: 'RESOLVED'
        };
        
        return {
          ...season,
          curveAddress,
          startTime: Number(startTime),
          endTime: Number(endTime),
          state: stateMap[Number(state)] || 'UNKNOWN',
          stateCode: Number(state),
          winnerCount: Number(winnerCount),
          isActive: Number(state) === 1,
          isEnded: Number(state) >= 2,
          isResolved: Number(state) === 3
        };
      } catch (err) {
        // Error fetching season details - return null to allow retry
        return null;
      }
    },
    enabled: Boolean(contracts.RAFFLE && seasonId),
    staleTime: 30000, // 30 seconds
  });
  
  // Query for user's position in the raffle
  const {
    data: userPosition,
    isLoading: isLoadingUserPosition,
    refetch: refetchUserPosition
  } = useQuery({
    queryKey: ['userPosition', address, seasonId, contracts.RAFFLE],
    queryFn: async () => {
      if (!address || !isConnected || !contracts.RAFFLE || !seasonId) {
        return { ticketCount: 0, startRange: 0, probability: 0 };
      }
      
      try {
        // Get user's position from Raffle contract
        const position = await publicClient.readContract({
          address: contracts.RAFFLE,
          abi: RaffleAbi,
          functionName: 'getPlayerPosition',
          args: [seasonId, address],
        });
        
        // Get total tickets for probability calculation
        const totalTickets = await publicClient.readContract({
          address: contracts.RAFFLE,
          abi: RaffleAbi,
          functionName: 'getTotalTickets',
          args: [seasonId],
        });
        
        const ticketCount = Number(position.ticketCount);
        const totalTicketsNum = Number(totalTickets);
        
        return {
          ticketCount,
          startRange: Number(position.startRange),
          probability: totalTicketsNum > 0 ? (ticketCount / totalTicketsNum) * 100 : 0
        };
      } catch (err) {
        // Error fetching user position - return default values
        return { ticketCount: 0, startRange: 0, probability: 0 };
      }
    },
    enabled: Boolean(address && isConnected && contracts.RAFFLE && seasonId),
    staleTime: 30000, // 30 seconds
  });
  
  // Query for winners
  const {
    data: winners,
    isLoading: isLoadingWinners,
    refetch: refetchWinners
  } = useQuery({
    queryKey: ['winners', seasonId, contracts.RAFFLE],
    queryFn: async () => {
      if (!contracts.RAFFLE || !seasonId || !seasonDetails?.isResolved) {
        return [];
      }
      
      try {
        const winnerCount = seasonDetails.winnerCount;
        const winners = [];
        
        for (let i = 0; i < winnerCount; i++) {
          const winner = await publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RaffleAbi,
            functionName: 'getSeasonWinner',
            args: [seasonId, i],
          });
          
          winners.push(winner);
        }
        
        return winners;
      } catch (err) {
        // Error fetching winners - return empty array
        return [];
      }
    },
    enabled: Boolean(contracts.RAFFLE && seasonId && seasonDetails?.isResolved),
    staleTime: 60 * 60 * 1000, // 1 hour (winners don't change)
  });
  
  // Mutation for buying tickets (batches approve + buy in a single ERC-5792 call)
  const buyTicketsMutation = useMutation({
    mutationFn: async ({ amount, maxCost }) => {
      if (!isConnected || !seasonDetails?.curveAddress) {
        throw new Error('Wallet not connected or curve not configured');
      }

      setError('');

      // Batch approve + buyTokens into a single executeBatch call
      const batchId = await executeBatch([
        {
          to: contracts.SOF,
          data: encodeFunctionData({
            abi: ERC20Abi,
            functionName: 'approve',
            args: [seasonDetails.curveAddress, maxCost],
          }),
        },
        {
          to: seasonDetails.curveAddress,
          data: encodeFunctionData({
            abi: CurveAbi,
            functionName: 'buyTokens',
            args: [amount, maxCost],
          }),
        },
      ], { sofAmount: maxCost });

      return { hash: batchId };
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['userPosition'] });
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] });
    },
    onError: (err) => {
      setError(err.message || 'Failed to buy tickets');
    }
  });
  
  // Refetch all data
  const refetchAll = () => {
    refetchSeasonDetails();
    refetchUserPosition();
    if (seasonDetails?.isResolved) {
      refetchWinners();
    }
  };
  
  return {
    seasonDetails,
    userPosition,
    winners,
    isLoading: isLoadingSeasonDetails || isLoadingUserPosition || 
               isLoadingWinners || buyTicketsMutation.isPending,
    error,
    buyTickets: buyTicketsMutation.mutate,
    refetch: refetchAll
  };
}

// Note: These ABIs are now imported from the centralized utility
// import { RafflePositionTrackerAbi, SOFBondingCurveAbi } from '@/utils/abis';
// Keeping placeholder comments for reference during migration
