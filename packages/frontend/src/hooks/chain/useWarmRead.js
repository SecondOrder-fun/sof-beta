import { useQuery } from '@tanstack/react-query';
import { buildApiUrl, bumpTelemetry, normalizeFetchError } from './internal';

const WARM_DEFAULT_STALE = 20_000;

// BigInt params crash JSON.stringify (which react-query uses to compare
// queryKeys). Stringify bigints with an `n` suffix so different bigint
// values don't collide with same-valued plain numbers/strings.
function serializeParamsForKey(params) {
  if (!params || typeof params !== 'object') return {};
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === 'bigint' ? `${v.toString()}n` : v,
    ]),
  );
}

export function useWarmRead({
  path,
  params = {},
  refetchInterval,
  staleTime = WARM_DEFAULT_STALE,
  enabled = true,
}) {
  return useQuery({
    queryKey: ['warm', path, serializeParamsForKey(params)],
    enabled,
    staleTime,
    refetchInterval,
    retry: 1,
    queryFn: async () => {
      bumpTelemetry('warm');
      const url = buildApiUrl(path, params);
      let response;
      try {
        response = await fetch(url, { headers: { Accept: 'application/json' } });
      } catch (err) {
        throw normalizeFetchError(err, null);
      }
      if (!response.ok) throw normalizeFetchError(null, response);
      return response.json();
    },
  });
}
