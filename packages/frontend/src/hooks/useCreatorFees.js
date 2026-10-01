// src/hooks/useCreatorFees.js
//
// Creator fees for a set of launches, straight from each launch's placer, and
// the write that claims or hands them on. Shaping and call-building live in
// lib/creatorFees.js; this file only reads and sends.
//
// Three multicalls for any number of launches, whatever the accounts:
//   1. TokenLaunchpad.placerOf(token) for each launch, plus placer() — the
//      current placer, so ETH already credited there counts even for a launch
//      not in the list (fees handed to this account by another creator)
//   2. per placer: CREATOR_FEE_BPS and claimableEth(account) for each account;
//      per launch: feeRecipientOf(token) and claimableToken(token, account)
//   3. collectFees(token) on its placer, SIMULATED (an eth_call through
//      Multicall3, nothing is sent): what a collection would pay out right now.
//      Permissionless, so the caller does not matter. A launch whose collect
//      would revert (e.g. FeeTreasuryNotSet) reads null — its claim then skips
//      the collect rather than failing.
// 2 and 3 run in parallel. Each launch is read through ITS placer, never the
// deployment's LiquidityPlacer: earlier launches stay where they were placed.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { TokenLaunchpadAbi, UniV4LiquidityPlacerAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { sendOptions } from '@/lib/creatorFees';

const ZERO_ADDRESS = /^0x0{40}$/i;
const lc = (a) => String(a).toLowerCase();

/**
 * @param {{ token: string }[]} launches
 * @param {{ accounts: { eoa?: string, sma?: string }, enabled?: boolean }} options
 * @returns {{ data: { launches: import('@/lib/creatorFees').LaunchFees[],
 *   placers: Record<string, import('@/lib/creatorFees').PlacerFees> } | undefined,
 *   isLoading: boolean, isError: boolean }}
 *   launches keep the input order; placers are keyed by lowercased address
 */
export function useCreatorFees(launches, { accounts = {}, enabled = true } = {}) {
  const client = usePublicClient();
  const launchpad = getContractAddresses(getStoredNetworkKey()).TOKEN_LAUNCHPAD;

  const tokens = [...new Set((launches || []).filter((l) => l?.token).map((l) => lc(l.token)))];
  const accountList = [...new Set([accounts.sma, accounts.eoa].filter(Boolean).map(lc))];

  const query = useQuery({
    queryKey: ['creatorFees', launchpad, tokens.join(','), accountList.join(',')],
    enabled: Boolean(enabled && client && launchpad && tokens.length && accountList.length),
    // Fees grow with every trade; refresh about as often as the pool price.
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [currentPlacer, ...placerOf] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'placer' },
          ...tokens.map((token) => ({
            address: launchpad,
            abi: TokenLaunchpadAbi,
            functionName: 'placerOf',
            args: [token],
          })),
        ],
        allowFailure: false,
      });

      // A token the launchpad does not know reads placer 0: nothing to read.
      const placed = tokens
        .map((token, i) => ({ token, placer: placerOf[i] }))
        .filter(({ placer }) => placer && !ZERO_ADDRESS.test(placer));
      const placerAddresses = [];
      for (const p of [...placed.map((x) => x.placer), currentPlacer]) {
        if (p && !ZERO_ADDRESS.test(p) && !placerAddresses.some((q) => lc(q) === lc(p))) placerAddresses.push(p);
      }
      if (!placerAddresses.length) return { launches: [], placers: {} };

      const placerReads = placerAddresses.flatMap((placer) => [
        { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'CREATOR_FEE_BPS' },
        ...accountList.map((account) => ({
          address: placer,
          abi: UniV4LiquidityPlacerAbi,
          functionName: 'claimableEth',
          args: [account],
        })),
      ]);
      const launchReads = placed.flatMap(({ token, placer }) => [
        { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'feeRecipientOf', args: [token] },
        ...accountList.map((account) => ({
          address: placer,
          abi: UniV4LiquidityPlacerAbi,
          functionName: 'claimableToken',
          args: [token, account],
        })),
      ]);

      const [reads, collects] = await Promise.all([
        client.multicall({ contracts: [...placerReads, ...launchReads], allowFailure: false }),
        placed.length
          ? client
              .multicall({
                contracts: placed.map(({ token, placer }) => ({
                  address: placer,
                  abi: UniV4LiquidityPlacerAbi,
                  functionName: 'collectFees',
                  args: [token],
                })),
                allowFailure: true,
              })
              .catch(() => [])
          : [],
      ]);

      let at = 0;
      /** @type {Record<string, import('@/lib/creatorFees').PlacerFees>} */
      const placers = {};
      for (const address of placerAddresses) {
        const creatorFeeBps = reads[at++];
        const claimableEth = {};
        for (const account of accountList) claimableEth[account] = reads[at++];
        // SOFPaymaster sponsors only the launchpad's current placer (an older one
        // needs setAllowlisted), so callers promise gasless claims only on this.
        const isCurrent = lc(address) === lc(currentPlacer);
        placers[lc(address)] = { address, creatorFeeBps, claimableEth, isCurrent };
      }

      const out = placed.map(({ token, placer }, i) => {
        const recipient = reads[at++];
        const claimableToken = {};
        for (const account of accountList) claimableToken[account] = reads[at++];
        const collected = collects[i]?.status === 'success' ? collects[i].result : null;
        return {
          token: (launches.find((l) => lc(l.token) === token) ?? {}).token ?? token,
          placer,
          recipient: recipient && !ZERO_ADDRESS.test(recipient) ? recipient : null,
          claimableToken,
          uncollectedEth: collected ? collected[0] : null,
          uncollectedTokens: collected ? collected[1] : null,
        };
      });

      return { launches: out, placers };
    },
  });

  return { data: query.data, isLoading: query.isLoading, isError: query.isError };
}

/**
 * Send claim or transfer batches from lib/creatorFees (`{ sender, calls }[]`),
 * one executeBatch each, in order. A sender in 'eoa' mode goes out with
 * `bypassSponsorship` — the only way executeBatch sends from the EOA, which is
 * the claimant there (see claimSender). Re-reads the fees however it ends: a
 * failure partway may still have landed the batches before it.
 *
 * @returns {{ send: (batches: object[]) => Promise<string | null>, isPending: boolean,
 *   error: Error | null, reset: () => void }}
 *   send resolves with the last batch's transaction hash
 */
export function useCreatorFeeWrite() {
  const { executeBatch } = useSmartTransactions();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (batches) => {
      let hash = null;
      for (const { sender, calls } of batches) {
        if (!sender) throw new Error('This account cannot send for that fee recipient');
        if (!calls?.length) continue;
        hash = await executeBatch(calls, sendOptions(sender));
      }
      return hash;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['creatorFees'] }),
  });

  return { send: mutation.mutateAsync, isPending: mutation.isPending, error: mutation.error, reset: mutation.reset };
}
