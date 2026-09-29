// src/hooks/useLaunchMarkets.js
//
// Live market state for launched tokens — price, FDV, multiple since launch,
// supply sold, and what a quote needs — straight from the Uniswap v4 pool.
//
// Two multicalls for any number of tokens, no indexer and no quoter contract:
//   1. UniV4LiquidityPlacer.getPlacement(token)  -> the position's tick range
//   2. PoolManager.extsload([slot0, liquidity])  -> the pool's current state
// The derivation is lib/v4PoolMath.js, pinned against a real PoolManager swap.

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { UniV4LiquidityPlacerAbi, PoolManagerAbi } from '@/utils/abis';
import { deriveMarketState, poolLiquiditySlot, poolStateSlot } from '@/lib/v4PoolMath';

const ZERO_POOL = /^0x0+$/;

/**
 * @param {{ token: string, placementId?: string }[]} launches
 * @param {{ wholeSupply?: bigint, enabled?: boolean }} [options]
 * @returns {{ markets: Record<string, object>, isLoading: boolean, isAvailable: boolean }}
 *   markets keyed by lowercased token address
 */
export function useLaunchMarkets(launches, { wholeSupply = 1_000_000_000n, enabled = true } = {}) {
  const client = usePublicClient();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const placer = contracts.LIQUIDITY_PLACER;
  const poolManager = contracts.POOL_MANAGER;

  const priced = (launches || []).filter(
    (l) => l?.token && l?.placementId && !ZERO_POOL.test(l.placementId),
  );
  const tokenKey = priced.map((l) => l.token.toLowerCase()).join(',');

  const query = useQuery({
    queryKey: ['launchMarkets', placer, poolManager, tokenKey],
    enabled: Boolean(enabled && client && placer && poolManager && priced.length),
    // Prices move with every trade; this is the live part of the page.
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [placements, states] = await Promise.all([
        client.multicall({
          contracts: priced.map((l) => ({
            address: placer,
            abi: UniV4LiquidityPlacerAbi,
            functionName: 'getPlacement',
            args: [l.token],
          })),
          allowFailure: true,
        }),
        client.multicall({
          contracts: priced.map((l) => ({
            address: poolManager,
            abi: PoolManagerAbi,
            functionName: 'extsload',
            args: [[poolStateSlot(l.placementId), poolLiquiditySlot(l.placementId)]],
          })),
          allowFailure: true,
        }),
      ]);

      /** @type {Record<string, object>} */
      const out = {};
      priced.forEach((l, i) => {
        if (placements[i]?.status !== 'success' || states[i]?.status !== 'success') return;
        const [slot0Word, liquidityWord] = states[i].result;
        const market = deriveMarketState({
          slot0Word,
          liquidityWord,
          placement: placements[i].result,
          wholeSupply,
        });
        if (market) out[l.token.toLowerCase()] = market;
      });
      return out;
    },
  });

  return {
    markets: query.data ?? {},
    isLoading: query.isLoading,
    isAvailable: Boolean(placer && poolManager),
    refetch: query.refetch,
  };
}
