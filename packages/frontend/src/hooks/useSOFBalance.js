// src/hooks/useSOFBalance.js
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useRaffleAccount } from '@/hooks/useRaffleAccount';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

/**
 * Hook to get the connected user's $SOF balance.
 *
 * Resolves at the user's smart account (spec §4.3) — gameplay balances
 * live at the SMA, not the connected EOA.
 *
 * Uses ultra-fresh reads so balances auto-update after any tx that
 * touches the SOF token contract.
 *
 * @returns {{ balance: bigint, balanceRaw: bigint, isLoading: boolean, refetch: function }}
 */
export function useSOFBalance() {
  const { sma: address, isReady } = useRaffleAccount();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const sofAddress = contracts?.SOF;

  const query = useUltraFreshRead({
    contract: { address: sofAddress, abi: ERC20Abi },
    fn: 'balanceOf',
    args: address ? [address] : [],
    touches: sofAddress ? [sofAddress] : [],
    enabled: !!(isReady && address && sofAddress),
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

export default useSOFBalance;
