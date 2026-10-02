// src/hooks/useCreatorFees.js
//
// Creator fees for a set of launches, straight from each launch's placer, and
// the write that claims or hands them on. Shaping and call-building live in
// lib/creatorFees.js; this file only reads and sends.
//
// Three multicalls for any number of launches:
//   1. TokenLaunchpad.placerOf(token) for each launch, plus placer() — the
//      current placer, so ETH already credited there counts even for a launch
//      not in the list (fees handed to this account by another creator)
//   2. per placer: CREATOR_FEE_BPS and claimableEth(account);
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

const ZERO_ADDRESS = /^0x0{40}$/i;
const lc = (a) => String(a).toLowerCase();

/**
 * @param {{ token: string }[]} launches
 * @param {{ account?: string, enabled?: boolean }} options  `account`: the
 *   connected wallet, whose credits are read
 * @returns {{ data: { launches: import('@/lib/creatorFees').LaunchFees[],
 *   placers: Record<string, import('@/lib/creatorFees').PlacerFees> } | undefined,
 *   isLoading: boolean, isError: boolean }}
 *   launches keep the input order; placers are keyed by lowercased address
 */
export function useCreatorFees(launches, { account, enabled = true } = {}) {
  const client = usePublicClient();
  const launchpad = getContractAddresses(getStoredNetworkKey()).TOKEN_LAUNCHPAD;

  const tokens = [...new Set((launches || []).filter((l) => l?.token).map((l) => lc(l.token)))];
  const accountList = account ? [lc(account)] : [];

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
        ...accountList.map((a) => ({
          address: placer,
          abi: UniV4LiquidityPlacerAbi,
          functionName: 'claimableEth',
          args: [a],
        })),
      ]);
      const launchReads = placed.flatMap(({ token, placer }) => [
        { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'feeRecipientOf', args: [token] },
        ...accountList.map((a) => ({
          address: placer,
          abi: UniV4LiquidityPlacerAbi,
          functionName: 'claimableToken',
          args: [token, a],
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
        for (const a of accountList) claimableEth[a] = reads[at++];
        placers[lc(address)] = { address, creatorFeeBps, claimableEth };
      }

      const out = placed.map(({ token, placer }, i) => {
        const recipient = reads[at++];
        const claimableToken = {};
        for (const a of accountList) claimableToken[a] = reads[at++];
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
 * Send a claim or transfer batch from lib/creatorFees through executeBatch,
 * from the connected wallet (the claimant). Re-reads the fees however it ends:
 * a failure partway through a sequential send may still have landed the calls
 * before it.
 *
 * @returns {{ send: (calls: object[]) => Promise<string | null>, isPending: boolean,
 *   error: Error | null, reset: () => void }}
 *   send resolves with the transaction hash, or null for an empty batch
 */
export function useCreatorFeeWrite() {
  const { executeBatch } = useSmartTransactions();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (calls) => {
      if (!calls?.length) return null;
      return executeBatch(calls);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['creatorFees'] }),
  });

  return { send: mutation.mutateAsync, isPending: mutation.isPending, error: mutation.error, reset: mutation.reset };
}
