import { useQuery } from '@tanstack/react-query';
import { buildApiUrl, bumpTelemetry, normalizeFetchError } from './internal';

const WARM_DEFAULT_STALE = 20_000;

export function useWarmRead({
  path,
  params = {},
  refetchInterval,
  staleTime = WARM_DEFAULT_STALE,
  enabled = true,
}) {
  return useQuery({
    queryKey: ['warm', path, params],
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
