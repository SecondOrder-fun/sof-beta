// src/hooks/useAccessControl.js
// Reactive role check via ultra-fresh reads. Refetches automatically when
// executeBatch touches the contract.

import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

/**
 * Reactive role check on any contract.
 * Refetches when executeBatch touches the contract address.
 *
 * @param {{ contract: { address: string, abi: Array }, role: `0x${string}`, account: string, enabled?: boolean }} params
 * @returns {{ hasRole: boolean, isLoading: boolean, refetch: function }}
 */
export function useAccessControl({ contract, role, account, enabled = true }) {
  const query = useUltraFreshRead({
    contract,
    fn: 'hasRole',
    args: role && account ? [role, account] : undefined,
    touches: contract?.address ? [contract.address] : [],
    enabled: enabled && !!contract?.address && !!role && !!account,
  });

  return {
    hasRole: !!query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export default useAccessControl;
