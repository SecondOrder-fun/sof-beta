// src/hooks/useAirdropStreak.js
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

const DAILY_CLAIMED_EVENT = parseAbiItem(
  'event DailyClaimed(address indexed user, uint256 amount)',
);

const SECONDS_PER_DAY = 86_400n;

/**
 * Walk a sorted list of unix timestamps (seconds) and count the longest
 * trailing run of consecutive days ending at the most recent claim.
 *
 * "Consecutive" means each gap is <= 1 day + grace. A claim happens at most
 * once per `cooldown` so two claims in the same UTC day cannot exist; any gap
 * larger than ~36h breaks the streak. The grace tolerates wall-clock drift
 * between the chain and the user's local clock.
 *
 * @param {bigint[]} timestamps Sorted ascending; values are unix seconds.
 * @returns {number} Streak length (>= 0).
 */
export function computeStreak(timestamps) {
  if (timestamps.length === 0) return 0;
  // Walk from newest to oldest; break on the first gap > 1.5 days.
  const grace = SECONDS_PER_DAY + SECONDS_PER_DAY / 2n; // 36h
  let streak = 1;
  for (let i = timestamps.length - 1; i > 0; i -= 1) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap <= grace) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Read on-chain `DailyClaimed` events for the connected wallet and compute
 * a consecutive-day streak. Frontend-only — moves to a backend index if
 * the eth_getLogs cost ever becomes a problem.
 *
 * @returns {{ streak: number, lastClaimAt: number | null, isLoading: boolean, isError: boolean }}
 */
export function useAirdropStreak() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const airdropAddress = contracts.SOF_AIRDROP;

  const enabled = Boolean(
    isConnected && address && airdropAddress && publicClient,
  );

  const query = useQuery({
    queryKey: ['airdropStreak', address?.toLowerCase(), airdropAddress, netKey],
    enabled,
    staleTime: 60_000, // refetch at most once per minute
    queryFn: async () => {
      // Pull every DailyClaimed for this wallet. fromBlock=0 is fine for
      // alpha-scale chains (Base sepolia, Anvil); revisit if mainnet RPC
      // imposes a smaller eth_getLogs window.
      const logs = await publicClient.getLogs({
        address: airdropAddress,
        event: DAILY_CLAIMED_EVENT,
        args: { user: address },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      if (logs.length === 0) {
        return { streak: 0, lastClaimAt: null };
      }

      // Pull each log's block timestamp. Most chains have getBlock cached
      // at the RPC layer so this is cheap, but parallelize anyway.
      const blocks = await Promise.all(
        logs.map((log) => publicClient.getBlock({ blockNumber: log.blockNumber })),
      );

      const timestamps = blocks
        .map((b) => b.timestamp)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const streak = computeStreak(timestamps);
      const lastClaimAt = Number(timestamps[timestamps.length - 1]) * 1000;

      return { streak, lastClaimAt };
    },
  });

  return {
    streak: query.data?.streak ?? 0,
    lastClaimAt: query.data?.lastClaimAt ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export default useAirdropStreak;
