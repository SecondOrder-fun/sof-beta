// src/hooks/useTokenLaunches.js
//
// The discovery feed, read straight from the chain.
//
// This deliberately does NOT go through the backend, unlike `useAllSeasons`. The
// launch indexer does not exist yet, and a feed that only works once it does
// would leave /tokens blank on a fresh deploy. The launchpad stores every launch
// in an array, so newest-first paging is two multicalls and no infrastructure.
//
// When the indexer lands, this becomes the fallback rather than the primary:
// metadata, trade volume and price history all need an index, and none of them
// can be read from `getLaunch`.

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { TokenLaunchpadAbi, ERC20Abi } from '@/utils/abis';

/** How many launches one page of the feed holds. */
export const LAUNCHES_PAGE_SIZE = 24;

/**
 * @typedef {Object} TokenLaunch
 * @property {number} launchId
 * @property {string} token
 * @property {string} creator
 * @property {bigint} launchedAt        — unix seconds
 * @property {bigint} startPriceWei     — wei of ETH per whole token
 * @property {bigint} impliedFdvWei     — startPriceWei * wholeSupply
 * @property {string} name
 * @property {string} symbol
 */

/**
 * Newest-first launches.
 *
 * @param {object} [options]
 * @param {number} [options.limit=LAUNCHES_PAGE_SIZE]
 * @param {boolean} [options.enabled=true]
 */
export function useTokenLaunches({ limit = LAUNCHES_PAGE_SIZE, enabled = true } = {}) {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  const query = useQuery({
    queryKey: ['tokenLaunches', launchpad, limit],
    enabled: Boolean(enabled && launchpad && client),
    // New launches are the whole point of the page, so this stays warm.
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [count, supply] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'launchCount' },
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'TOKEN_SUPPLY' },
        ],
        allowFailure: false,
      });

      const total = Number(count);
      if (total === 0) return { launches: [], total: 0 };

      const wholeSupply = supply / 10n ** 18n;

      // Newest first: the array is append-only, so the last index is the newest.
      const ids = [];
      for (let i = total - 1; i >= 0 && ids.length < limit; i--) ids.push(i);

      const records = await client.multicall({
        contracts: ids.map((id) => ({
          address: launchpad,
          abi: TokenLaunchpadAbi,
          functionName: 'getLaunch',
          args: [BigInt(id)],
        })),
        allowFailure: true,
      });

      // Name and symbol live on the token, not in the launch record — the
      // launchpad emits them but does not store them (storing would need a
      // setter, and a setter lets a creator swap the name after people buy).
      const present = [];
      for (let i = 0; i < ids.length; i++) {
        if (records[i]?.status !== 'success') continue;
        present.push({ launchId: ids[i], record: records[i].result });
      }

      const metadata = await client.multicall({
        contracts: present.flatMap(({ record }) => [
          { address: record.token, abi: ERC20Abi, functionName: 'name' },
          { address: record.token, abi: ERC20Abi, functionName: 'symbol' },
        ]),
        allowFailure: true,
      });

      const launches = present.map(({ launchId, record }, i) => {
        const nameRes = metadata[i * 2];
        const symbolRes = metadata[i * 2 + 1];
        return {
          launchId,
          token: record.token,
          creator: record.creator,
          launchedAt: record.launchedAt,
          startPriceWei: record.startPriceWei,
          impliedFdvWei: record.startPriceWei * wholeSupply,
          name: nameRes?.status === 'success' ? nameRes.result : '',
          symbol: symbolRes?.status === 'success' ? symbolRes.result : '',
        };
      });

      return { launches, total };
    },
  });

  return {
    ...query,
    launches: query.data?.launches ?? [],
    total: query.data?.total ?? 0,
    isAvailable: Boolean(launchpad),
  };
}

/**
 * One launched token by address, for /tokens/:address.
 *
 * Returns `null` (not an error) when the address is not a launchpad token —
 * `isLaunchToken` is the registry the contracts themselves trust, so a miss
 * means "not ours", which the route renders as a not-found rather than a failure.
 *
 * @param {string | undefined} tokenAddress
 */
export function useTokenLaunch(tokenAddress) {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  const query = useQuery({
    queryKey: ['tokenLaunch', launchpad, tokenAddress?.toLowerCase()],
    enabled: Boolean(launchpad && client && tokenAddress),
    staleTime: Infinity, // A launch record never changes after the launch tx.
    queryFn: async () => {
      const [idRes, supplyRes] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'launchIdOf', args: [tokenAddress] },
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'TOKEN_SUPPLY' },
        ],
        allowFailure: false,
      });

      const [launchId, exists] = idRes;
      if (!exists) return null;

      const wholeSupply = supplyRes / 10n ** 18n;

      const [record, name, symbol] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'getLaunch', args: [launchId] },
          { address: tokenAddress, abi: ERC20Abi, functionName: 'name' },
          { address: tokenAddress, abi: ERC20Abi, functionName: 'symbol' },
        ],
        allowFailure: false,
      });

      return {
        launchId: Number(launchId),
        token: record.token,
        creator: record.creator,
        launchedAt: record.launchedAt,
        startPriceWei: record.startPriceWei,
        impliedFdvWei: record.startPriceWei * wholeSupply,
        placementId: record.placementId,
        totalSupply: supplyRes,
        name,
        symbol,
      };
    },
  });

  return { ...query, isAvailable: Boolean(launchpad) };
}
