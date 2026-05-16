import { useQuery } from '@tanstack/react-query';
import { buildApiUrl, bumpTelemetry, normalizeFetchError, API_BASE } from './internal';

const COLD_DEFAULT_STALE = 5 * 60_000;

export function useColdRead({
  endpoint,
  params = {},
  staleTime = COLD_DEFAULT_STALE,
  enabled = true,
}) {
  return useQuery({
    queryKey: ['cold', endpoint, params],
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
