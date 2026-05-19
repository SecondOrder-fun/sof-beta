import { useQuery } from '@tanstack/react-query';
import { buildApiUrl, bumpTelemetry, normalizeFetchError, API_BASE } from './internal';

const COLD_DEFAULT_STALE = 5 * 60_000;

// Same BigInt-safe serialization as useWarmRead — see that file for rationale.
function serializeParamsForKey(params) {
  if (!params || typeof params !== 'object') return {};
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === 'bigint' ? `${v.toString()}n` : v,
    ]),
  );
}

export function useColdRead({
  endpoint,
  params = {},
  staleTime = COLD_DEFAULT_STALE,
  enabled = true,
}) {
  return useQuery({
    queryKey: ['cold', endpoint, serializeParamsForKey(params)],
    enabled,
    staleTime,
    retry: 1,
    queryFn: async () => {
      bumpTelemetry('cold');
      const url = buildApiUrl(`/blockscout/${endpoint}`, params);
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

export { API_BASE };
