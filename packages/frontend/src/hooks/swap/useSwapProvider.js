import { useMemo } from 'react';
import { usePublicClient } from 'wagmi';
import { createFixedRateProvider } from './providers/fixedRateProvider';

export function useSwapProvider() {
  const client = usePublicClient();
  const provider = useMemo(() => {
    if (!client) return null;
    return createFixedRateProvider(client);
  }, [client]);

  return provider;
}
