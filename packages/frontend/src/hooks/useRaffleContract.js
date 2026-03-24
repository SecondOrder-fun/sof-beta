import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi';
import { parseEther } from 'viem';
import { RaffleAbi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

// Get contract address dynamically from config
const getRaffleAddress = () => {
  const netKey = getStoredNetworkKey();
  const addresses = getContractAddresses(netKey);
  return addresses.RAFFLE || '0x0000000000000000000000000000000000000000';
};

const RAFFLE_CONTRACT_ADDRESS = getRaffleAddress();

export const useRaffleContract = () => {
  const { writeContract, data: hash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const joinRaffle = async (raffleId, amount) => {
    await writeContract({
      address: RAFFLE_CONTRACT_ADDRESS,
      abi: RaffleAbi,
      functionName: 'joinRaffle',
      args: [raffleId],
      value: parseEther(amount.toString()),
    });
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
