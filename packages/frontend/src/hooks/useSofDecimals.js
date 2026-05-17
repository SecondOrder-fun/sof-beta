// src/hooks/useSofDecimals.js
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

/**
 * useSofDecimals
 *
 * Decimals never change for an ERC-20 token. Read once with infinite
 * staleTime; no tx will ever invalidate it (touches is empty).
 *
 * Returns the decimals as a plain number (18 fallback) for backward
 * compatibility with all existing consumers.
 */
export function useSofDecimals() {
  const contracts = getContractAddresses(getStoredNetworkKey());
  const sofAddress = contracts?.SOF;

  const query = useUltraFreshRead({
    contract: { address: sofAddress, abi: ERC20Abi },
    fn: 'decimals',
    args: [],
    touches: [],
    enabled: !!sofAddress,
    staleTime: Infinity,
  });

  // Return plain number for backward compatibility — all consumers use
  // `const sofDecimals = useSofDecimals()` and pass it directly to formatUnits.
  return typeof query.data === 'bigint'
    ? Number(query.data)
    : (typeof query.data === 'number' ? query.data : 18);
}

export default useSofDecimals;
