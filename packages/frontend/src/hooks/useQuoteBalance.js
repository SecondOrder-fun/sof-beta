// src/hooks/useQuoteBalance.js
import { useAccount } from 'wagmi';
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

/**
 * Hook to get the connected user's balance of a quote token.
 *
 * Seasons are priced in a per-season quote token, so callers that are
 * season-scoped should pass that season's token (see useSeasonQuoteToken).
 * Callers that are not season-scoped — the profile page, sponsor staking —
 * fall back to the platform-level placeholder quote token.
 *
 * Uses ultra-fresh reads so balances auto-update after any tx that
 * touches the token contract.
 *
 * @param {`0x${string}` | undefined} [tokenAddress] Token to read. Defaults to
 *   the platform quote token.
 * @returns {{ balance: bigint, balanceRaw: bigint, isLoading: boolean, refetch: function }}
 */
export function useQuoteBalance(tokenAddress) {
  const { address } = useAccount();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const token = tokenAddress || contracts?.QUOTE_TOKEN;

  const query = useUltraFreshRead({
    contract: { address: token, abi: ERC20Abi },
    fn: 'balanceOf',
    args: address ? [address] : [],
    touches: token ? [token] : [],
    enabled: !!(address && token),
  });

  const raw = query.data ?? 0n;
  return {
    // Legacy: bigint for backward compat with existing consumers
    balance: raw,
    // New: formatted string for display
    balanceRaw: raw,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export default useQuoteBalance;
