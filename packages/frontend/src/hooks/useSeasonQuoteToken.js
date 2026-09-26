// src/hooks/useSeasonQuoteToken.js
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { SOFBondingCurveAbi } from '@/utils/abis';

/**
 * Resolve the ERC-20 a season's tickets are priced in.
 *
 * Each season names its own quote token, so there is no single platform
 * currency to read. The season's bonding curve is the authority: it is
 * constructed with that token and will not accept any other, so reading
 * `quoteToken()` off the curve is the one source that cannot disagree with
 * what a buy will actually spend.
 *
 * The value is immutable for the life of a curve (it is an `immutable` in the
 * contract), so this is cached indefinitely.
 *
 * @param {`0x${string}` | undefined} bondingCurveAddress
 * @returns {{ quoteToken: `0x${string}` | undefined, isLoading: boolean }}
 */
export function useSeasonQuoteToken(bondingCurveAddress) {
  const publicClient = usePublicClient();

  const { data, isLoading } = useQuery({
    queryKey: ['seasonQuoteToken', bondingCurveAddress],
    queryFn: async () => {
      if (!bondingCurveAddress || !publicClient) return null;
      try {
        return await publicClient.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: 'quoteToken',
        });
      } catch {
        return null;
      }
    },
    enabled: Boolean(bondingCurveAddress && publicClient),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return { quoteToken: data ?? undefined, isLoading };
}

export default useSeasonQuoteToken;
