// src/hooks/useLaunchTrade.js
//
// The active launch router, and the trade that goes through it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { TokenLaunchpadAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { buildTradeCalls } from '@/lib/launchTrade';

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * The router the launchpad currently advertises, or null when in-app trading is
 * off (TokenLaunchpad.setRouter(0)) or no launchpad exists here.
 *
 * Re-read every minute rather than cached forever: switching routers is meant
 * to reach open tabs without a reload.
 */
export function useLaunchRouter() {
  const client = usePublicClient();
  const launchpad = getContractAddresses(getStoredNetworkKey()).TOKEN_LAUNCHPAD;

  const query = useQuery({
    queryKey: ['launchRouter', launchpad],
    enabled: Boolean(client && launchpad),
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const router = await client.readContract({
        address: launchpad,
        abi: TokenLaunchpadAbi,
        functionName: 'router',
      });
      return router && router !== ZERO ? router : null;
    },
  });

  return { router: query.data ?? null, isLoading: query.isLoading };
}

/**
 * Execute a buy or sell through the active router, via executeBatch. Sent from
 * and settled to the connected wallet — the account every in-app balance is
 * read from.
 */
export function useLaunchTrade() {
  const { executeBatch } = useSmartTransactions();
  const { address } = useAccount();
  const { router } = useLaunchRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ side, token, amountIn, minOut }) => {
      if (!address) throw new Error('Account not ready');
      const calls = buildTradeCalls({ side, router, token, amountIn, minOut, recipient: address });
      return executeBatch(calls);
    },
    onSuccess: () => {
      // The pool moved: re-price every card and the token page.
      queryClient.invalidateQueries({ queryKey: ['launchMarkets'] });
    },
  });

  return {
    trade: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    router,
    canTrade: Boolean(router && address),
  };
}
