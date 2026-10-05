// src/hooks/useCreatorFees.js
//
// Creator fees for a set of launches, straight from each launch's placer, and
// the write that claims or hands them on. Shaping and call-building live in
// lib/creatorFees.js; this file only reads and sends.
//
// Three multicalls for any number of launches (plus a symbol/decimals read for
// any quote token config/launchQuoteTokens.js does not list):
//   1. TokenLaunchpad.placerOf(token) and quoteTokenOf(token) for each launch,
//      plus placer() — the current placer, so quote fees already credited there
//      count even for a launch not in the list (fees handed to this account by
//      another creator)
//   2. per placer: CREATOR_FEE_BPS and claimable(currency, account) for every
//      quote currency that matters there — ETH, the network's listed quotes, and
//      the quotes of the listed launches on it;
//      per launch: feeRecipientOf(token) and claimable(token, account)
//   3. collectFees(token) on its placer, SIMULATED (an eth_call through
//      Multicall3, nothing is sent): what a collection would pay out right now,
//      as (quoteFees, tokenFees). Permissionless, so the caller does not matter.
//      A launch whose collect would revert (e.g. FeeTreasuryNotSet) reads null —
//      its claim then skips the collect rather than failing.
// 2 and 3 run in parallel. Each launch is read through ITS placer, never the
// deployment's LiquidityPlacer: earlier launches stay where they were placed.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { getLaunchQuoteTokens } from '@/config/launchQuoteTokens';
import { TokenLaunchpadAbi, UniV4LiquidityPlacerAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { currencyKey } from '@/lib/creatorFees';
import { resolveQuoteMeta } from '@/lib/launchQuote';

const ZERO_ADDRESS = /^0x0{40}$/i;
const lc = (a) => String(a).toLowerCase();

/**
 * @param {{ token: string }[]} launches
 * @param {{ account?: string, enabled?: boolean }} options  `account`: the
 *   connected wallet, whose credits are read
 * @returns {{ data: { launches: import('@/lib/creatorFees').LaunchFees[],
 *   placers: Record<string, import('@/lib/creatorFees').PlacerFees>,
 *   quotes: Record<string, import('@/config/launchQuoteTokens').LaunchQuote> } | undefined,
 *   isLoading: boolean, isError: boolean }}
 *   launches keep the input order; placers are keyed by lowercased address;
 *   quotes (symbol and decimals of every quote currency read) by currencyKey
 */
export function useCreatorFees(launches, { account, enabled = true } = {}) {
  const client = usePublicClient();
  const networkKey = getStoredNetworkKey();
  const launchpad = getContractAddresses(networkKey).TOKEN_LAUNCHPAD;

  const tokens = [...new Set((launches || []).filter((l) => l?.token).map((l) => lc(l.token)))];
  const accountList = account ? [lc(account)] : [];

  const query = useQuery({
    queryKey: ['creatorFees', launchpad, tokens.join(','), accountList.join(',')],
    enabled: Boolean(enabled && client && launchpad && tokens.length && accountList.length),
    // Fees grow with every trade; refresh about as often as the pool price.
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [currentPlacer, ...perToken] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'placer' },
          ...tokens.flatMap((token) => [
            { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'placerOf', args: [token] },
            { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'quoteTokenOf', args: [token] },
          ]),
        ],
        allowFailure: false,
      });

      // A token the launchpad does not know reads placer 0: nothing to read.
      const placed = tokens
        .map((token, i) => ({ token, placer: perToken[i * 2], quoteToken: perToken[i * 2 + 1] }))
        .filter(({ placer }) => placer && !ZERO_ADDRESS.test(placer));
      const placerAddresses = [];
      for (const p of [...placed.map((x) => x.placer), currentPlacer]) {
        if (p && !ZERO_ADDRESS.test(p) && !placerAddresses.some((q) => lc(q) === lc(p))) placerAddresses.push(p);
      }
      if (!placerAddresses.length) return { launches: [], placers: {}, quotes: {} };

      // The quote currencies each placer is asked about: ETH and the network's
      // listed quotes everywhere, plus whatever the listed launches pair with.
      const listed = getLaunchQuoteTokens(networkKey).map((q) => q.address);
      const currenciesFor = (placer) => {
        const out = [];
        for (const c of [...listed, ...placed.filter((x) => lc(x.placer) === lc(placer)).map((x) => x.quoteToken)]) {
          if (!out.some((o) => currencyKey(o) === currencyKey(c))) out.push(c);
        }
        return out;
      };
      const placerCurrencies = placerAddresses.map(currenciesFor);

      const placerReads = placerAddresses.flatMap((placer, p) => [
        { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'CREATOR_FEE_BPS' },
        ...placerCurrencies[p].flatMap((currency) =>
          accountList.map((a) => ({
            address: placer,
            abi: UniV4LiquidityPlacerAbi,
            functionName: 'claimable',
            args: [currency, a],
          })),
        ),
      ]);
      const launchReads = placed.flatMap(({ token, placer }) => [
        { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'feeRecipientOf', args: [token] },
        ...accountList.map((a) => ({
          address: placer,
          abi: UniV4LiquidityPlacerAbi,
          functionName: 'claimable',
          args: [token, a],
        })),
      ]);

      const allCurrencies = placerCurrencies.flat();
      const [reads, collects, quotes] = await Promise.all([
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
        resolveQuoteMeta(client, allCurrencies, networkKey),
      ]);

      let at = 0;
      /** @type {Record<string, import('@/lib/creatorFees').PlacerFees>} */
      const placers = {};
      placerAddresses.forEach((address, p) => {
        const creatorFeeBps = reads[at++];
        const claimable = {};
        for (const currency of placerCurrencies[p]) {
          const byAccount = {};
          for (const a of accountList) byAccount[a] = reads[at++];
          claimable[currencyKey(currency)] = byAccount;
        }
        placers[lc(address)] = { address, creatorFeeBps, claimable };
      });

      const out = placed.map(({ token, placer, quoteToken }, i) => {
        const recipient = reads[at++];
        const claimableTokens = {};
        for (const a of accountList) claimableTokens[a] = reads[at++];
        const collected = collects[i]?.status === 'success' ? collects[i].result : null;
        return {
          token: (launches.find((l) => lc(l.token) === token) ?? {}).token ?? token,
          placer,
          quoteToken,
          recipient: recipient && !ZERO_ADDRESS.test(recipient) ? recipient : null,
          claimableTokens,
          uncollectedQuote: collected ? collected[0] : null,
          uncollectedTokens: collected ? collected[1] : null,
        };
      });

      return { launches: out, placers, quotes };
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
