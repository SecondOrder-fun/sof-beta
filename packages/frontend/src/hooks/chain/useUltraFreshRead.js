import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { bumpTelemetry } from './internal';

const ULTRA_FRESH_DEFAULT_STALE = 5_000;

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
    queryKey: ['ultraFresh', contract?.address, fn, args],
    enabled: enabled && !!publicClient && !!contract?.address && !!fn,
    staleTime,
    retry: 1,
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
