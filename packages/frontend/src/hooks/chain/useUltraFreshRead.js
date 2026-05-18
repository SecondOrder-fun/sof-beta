import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { bumpTelemetry } from './internal';

const ULTRA_FRESH_DEFAULT_STALE = 5_000;

// React-Query JSON.stringifies queryKeys for cache lookup; BigInt args
// (common when passing seasonId or token amounts) crash the stringifier.
// Normalize bigints in the key only — the contract call still receives
// the original BigInt-typed args. Defensive: callers sometimes pass
// `undefined` for args when gating on enabled, which would crash .map.
function serializeArgsForKey(args) {
  if (!Array.isArray(args)) return [];
  return args.map((a) => (typeof a === 'bigint' ? `${a.toString()}n` : a));
}

export function useUltraFreshRead({
  contract,
  fn,
  args = [],
  touches = [],
  enabled = true,
  staleTime = ULTRA_FRESH_DEFAULT_STALE,
}) {
  const publicClient = usePublicClient();
  return useQuery({
    queryKey: ['ultraFresh', contract?.address, fn, serializeArgsForKey(args)],
    enabled: enabled && !!publicClient && !!contract?.address && !!fn,
    staleTime,
    retry: 1,
    // Ultra-fresh data is invalidated by executeBatch.onSuccess (centralized
    // predicate via `touches`). Window focus / reconnect refetches are
    // unnecessary RPC pressure on top of that — every tab return on the
    // raffle detail page was re-firing every mounted ultra-fresh query.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { tier: 'ultraFresh', touches },
    queryFn: async () => {
      bumpTelemetry('ultraFresh');
      return await publicClient.readContract({
        address: contract.address,
        abi: contract.abi,
        functionName: fn,
        args,
      });
    },
  });
}
