import {
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi';
import { parseEther, encodeFunctionData } from 'viem';
import { RaffleAbi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { useState } from 'react';

// Get contract address dynamically from config
const getRaffleAddress = () => {
  const netKey = getStoredNetworkKey();
  const addresses = getContractAddresses(netKey);
  return addresses.RAFFLE || '0x0000000000000000000000000000000000000000';
};

const RAFFLE_CONTRACT_ADDRESS = getRaffleAddress();

export const useRaffleContract = () => {
  const { executeBatch } = useSmartTransactions();
  const [hash, setHash] = useState(undefined);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const joinRaffle = async (raffleId, amount) => {
    setIsPending(true);
    setError(null);
    try {
      const batchId = await executeBatch([{
        to: RAFFLE_CONTRACT_ADDRESS,
        data: encodeFunctionData({
          abi: RaffleAbi,
          functionName: 'joinRaffle',
          args: [raffleId],
        }),
        value: parseEther(amount.toString()),
      }], { sofAmount: 0n });
      setHash(batchId);
    } catch (err) {
      setError(err);
    } finally {
      setIsPending(false);
    }
  };

  return {
    joinRaffle,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
};

// Read-only contract hooks
export const useRaffleInfo = (raffleId) => {
  return useReadContract({
    address: RAFFLE_CONTRACT_ADDRESS,
    abi: RaffleAbi,
    functionName: 'getRaffleInfo',
    args: [raffleId],
    enabled: !!raffleId,
  });
};

export const useUserPosition = (raffleId, userAddress) => {
  return useReadContract({
    address: RAFFLE_CONTRACT_ADDRESS,
    abi: RaffleAbi,
    functionName: 'getUserPosition',
    args: [raffleId, userAddress],
    enabled: !!(raffleId && userAddress),
  });
};
