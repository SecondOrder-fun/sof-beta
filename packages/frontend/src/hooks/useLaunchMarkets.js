// src/hooks/useLaunchMarkets.js
//
// Live market state for launched tokens — price, FDV, multiple since launch,
// supply sold, and what a quote needs — straight from the Uniswap v4 pool.
//
// Three multicalls for any number of tokens, no indexer and no quoter contract:
//   1. TokenLaunchpad.placerOf(token)            -> the placer holding the position
//      PoolManager.extsload([slot0, liquidity])  -> the pool's current state (in parallel)
//   2. <that placer>.getPlacement(token)         -> the position's tick range
// Each launch is read through ITS placer, not the deployment's current one: the
// launchpad's placer can be replaced, and earlier launches stay where they were placed.
// The derivation is lib/v4PoolMath.js, pinned against a real PoolManager swap.

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { UniV4LiquidityPlacerAbi, PoolManagerAbi, TokenLaunchpadAbi } from '@/utils/abis';
import { deriveMarketState, poolLiquiditySlot, poolStateSlot } from '@/lib/v4PoolMath';

const ZERO_POOL = /^0x0+$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

/**
 * @param {{ token: string, placementId?: string }[]} launches
 * @param {{ wholeSupply?: bigint, enabled?: boolean }} [options]
 * @returns {{ markets: Record<string, object>, isLoading: boolean, isAvailable: boolean }}
 *   markets keyed by lowercased token address
 */
export function useLaunchMarkets(launches, { wholeSupply = 1_000_000_000n, enabled = true } = {}) {
  const client = usePublicClient();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const launchpad = contracts.TOKEN_LAUNCHPAD;
  const poolManager = contracts.POOL_MANAGER;

  const priced = (launches || []).filter(
    (l) => l?.token && l?.placementId && !ZERO_POOL.test(l.placementId),
  );
  const tokenKey = priced.map((l) => l.token.toLowerCase()).join(',');

  const query = useQuery({
    queryKey: ['launchMarkets', launchpad, poolManager, tokenKey],
    enabled: Boolean(enabled && client && launchpad && poolManager && priced.length),
    // Prices move with every trade; this is the live part of the page.
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [placers, states] = await Promise.all([
        client.multicall({
          contracts: priced.map((l) => ({
            address: launchpad,
            abi: TokenLaunchpadAbi,
            functionName: 'placerOf',
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

      // A token the launchpad does not know reads placer 0 — nothing to look up.
      const placerFor = priced.map((_, i) =>
        placers[i]?.status === 'success' && !ZERO_ADDRESS.test(placers[i].result) ? placers[i].result : null,
      );
      const lookups = priced.map((l, i) => ({ token: l.token, placer: placerFor[i], i })).filter((x) => x.placer);
      const placementResults = lookups.length
        ? await client.multicall({
            contracts: lookups.map(({ token, placer }) => ({
              address: placer,
              abi: UniV4LiquidityPlacerAbi,
              functionName: 'getPlacement',
              args: [token],
            })),
            allowFailure: true,
          })
        : [];
      const placements = [];
      lookups.forEach(({ i }, j) => {
        placements[i] = placementResults[j];
      });

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
    isAvailable: Boolean(launchpad && poolManager),
    refetch: query.refetch,
  };
}
