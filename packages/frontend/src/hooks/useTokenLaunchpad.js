// src/hooks/useTokenLaunchpad.js
//
// The launchpad's configuration, and the launch transaction itself.
//
// A launch is paired with a quote token — native ETH or an ERC-20 on the
// launchpad's allowlist — and opens at a valuation (`startFdv`) in that quote's
// raw units. A starting price on its own would be meaningless: every launch
// mints the same 1e9 supply, so a per-token price is nine orders of magnitude
// smaller than the valuation and, in a 6-decimal quote like USDC, too coarse to
// express. The contract takes the valuation directly and bounds it per quote
// (`quoteConfig`), so the form works in valuations and passes them straight
// through.
//
// The creator also picks the pool's trade fee (`tradeFee`, pips: 10_000 = 1%),
// charged by the placer — the pool's v4 hook — on every buy and sell, always in
// the quote token, and fixed for the pool's life. The placer bounds it:
// `minTradeFee()` (CONFIG_ROLE) to `MAX_TRADE_FEE` (10%, compiled in).
//
// The creator may also make a first buy inside the launch transaction
// (`creatorBuyIn`), executed right after the pool is placed and before anyone
// else can trade.

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { encodeFunctionData } from 'viem';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { getLaunchQuoteTokens, isNativeQuote } from '@/config/launchQuoteTokens';
import { TokenLaunchpadAbi, UniV4LiquidityPlacerAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { approveCall } from '@/lib/launchTrade';
import { MAX_TRADE_FEE } from '@/lib/v4PoolMath';

/**
 * Contract limits, mirrored so the form can validate before asking for a signature.
 * The contract counts UTF-8 BYTES (`bytes(name).length`), not characters: an emoji or a
 * CJK character is 3-4 bytes, so measure with `utf8Length`, never `.length`.
 */
export const MAX_NAME_LENGTH = 48;
export const MAX_SYMBOL_LENGTH = 16;

/** The trade fee a launch starts with in the form, in pips: 1%. */
export const DEFAULT_TRADE_FEE = 10_000;
/** The form's trade-fee presets, in pips: 0.5%, 1%, 2%, 5%. */
export const TRADE_FEE_PRESETS = [5_000, 10_000, 20_000, 50_000];
/** UniV4LiquidityPlacer.CREATOR_FEE_BPS as a percentage: the fee recipient's share, the
 *  rest going to SecondOrder's treasury. Compiled into the placer. */
export const CREATOR_FEE_PCT = 88;

const encoder = new TextEncoder();

/** Length in UTF-8 bytes — the unit the launchpad's length limits are in. */
export function utf8Length(value) {
  return encoder.encode(String(value ?? '')).length;
}

/**
 * Launchpad config: the supply, and every quote token a launch may pair with —
 * the network's candidates (config/launchQuoteTokens.js) that the launchpad
 * reports `allowed` in `quoteConfig`, each with its valuation bounds in its own
 * raw units.
 *
 * Everything here is admin-only, so it is cold — `staleTime: Infinity`. A quote
 * or bounds change is rare enough that a page reload is an acceptable way to see it.
 */
export function useLaunchpadConfig() {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;
  const candidates = getLaunchQuoteTokens(netKey);

  const query = useQuery({
    queryKey: ['launchpadConfig', launchpad, candidates.map((q) => q.address).join(',')],
    enabled: Boolean(launchpad && client),
    staleTime: Infinity,
    queryFn: async () => {
      const [supply, ...configs] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'TOKEN_SUPPLY' },
          ...candidates.map((q) => ({
            address: launchpad,
            abi: TokenLaunchpadAbi,
            functionName: 'quoteConfig',
            args: [q.address],
          })),
        ],
        allowFailure: true,
      });
      if (supply.status !== 'success') throw supply.error ?? new Error('TOKEN_SUPPLY read failed');

      // quoteConfig returns (allowed, minStartFdv, maxStartFdv) positionally.
      const quotes = candidates
        .map((q, i) => {
          const c = configs[i];
          if (c?.status !== 'success' || !c.result[0]) return null;
          return { ...q, minFdv: c.result[1], maxFdv: c.result[2] };
        })
        .filter(Boolean);

      return {
        totalSupply: supply.result,
        // Whole tokens. Launch tokens are always 18 dp.
        wholeSupply: supply.result / 10n ** 18n,
        quotes,
      };
    },
  });

  return {
    ...query,
    /** False when this network has no launchpad deployed — not an error state. */
    isAvailable: Boolean(launchpad),
    launchpadAddress: launchpad,
  };
}

/**
 * Whether the launchpad can actually launch: it needs a liquidity placer, or
 * `launch()` reverts `PlacerNotSet`. A deploy on a chain without Uniswap v4
 * leaves it that way deliberately, so the UI should say so rather than let
 * someone sign a transaction that cannot succeed.
 */
export function useLaunchpadReady() {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  return useQuery({
    queryKey: ['launchpadReady', launchpad],
    enabled: Boolean(launchpad && client),
    staleTime: Infinity,
    queryFn: async () => {
      const placer = await client.readContract({
        address: launchpad,
        abi: TokenLaunchpadAbi,
        functionName: 'placer',
      });
      return placer && placer !== '0x0000000000000000000000000000000000000000';
    },
  });
}

/**
 * The trade-fee range a new launch may choose, from the launchpad's current
 * placer: `minTradeFee()` (CONFIG_ROLE, 0.5% at deploy) to `MAX_TRADE_FEE()`
 * (10%, compiled in). Cold like the rest of the config. `data` is
 * `{ min, max }` in pips; while it loads (or with no placer) the form checks
 * only the compiled-in maximum.
 */
export function useTradeFeeBounds() {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const launchpad = getContractAddresses(netKey).TOKEN_LAUNCHPAD;

  return useQuery({
    queryKey: ['launchTradeFeeBounds', launchpad],
    enabled: Boolean(launchpad && client),
    staleTime: Infinity,
    queryFn: async () => {
      const placer = await client.readContract({ address: launchpad, abi: TokenLaunchpadAbi, functionName: 'placer' });
      if (!placer || /^0x0{40}$/i.test(placer)) return null;
      const [min, max] = await client.multicall({
        contracts: [
          { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'minTradeFee' },
          { address: placer, abi: UniV4LiquidityPlacerAbi, functionName: 'MAX_TRADE_FEE' },
        ],
        allowFailure: false,
      });
      return { min: Number(min), max: Number(max) };
    },
  });
}

/**
 * The calls for one launch, for executeBatch.
 *
 * - ETH-paired: one call; a first buy is sent as its `value` (the contract
 *   requires msg.value == creatorBuyIn exactly).
 * - ERC-20-paired with a first buy: approve the LAUNCHPAD for creatorBuyIn, then
 *   launch with no ETH — the launchpad pulls the quote and buys through the router.
 * - ERC-20-paired without one: just the launch.
 *
 * `minTokensOut` defaults to 0, deliberately: the creator buy runs inside the
 * launch transaction, right after the pool is created, so no other trade can
 * come between the pool's creation and the buy — what it receives is fixed by
 * the valuation and the trade fee, and a slippage floor would protect nothing.
 *
 * @param {object} p
 * @param {`0x${string}`} p.launchpad
 * @param {string} p.name
 * @param {string} p.symbol
 * @param {string} [p.metadataURI]
 * @param {`0x${string}`} p.quoteToken     address 0 for ETH
 * @param {bigint} p.startFdv              quote raw units
 * @param {number} p.tradeFee              pips (10_000 = 1%), within the placer's bounds
 * @param {bigint} [p.creatorBuyIn=0n]     quote raw units
 * @param {bigint} [p.minTokensOut=0n]
 * @returns {{ to: `0x${string}`, data: `0x${string}`, value?: bigint }[]}
 */
export function buildLaunchCalls({
  launchpad,
  name,
  symbol,
  metadataURI,
  quoteToken,
  startFdv,
  tradeFee,
  creatorBuyIn = 0n,
  minTokensOut = 0n,
}) {
  if (!Number.isInteger(tradeFee) || tradeFee <= 0) throw new Error('A trade fee is required');
  const launch = {
    to: launchpad,
    data: encodeFunctionData({
      abi: TokenLaunchpadAbi,
      functionName: 'launch',
      args: [name, symbol, metadataURI ?? '', quoteToken, startFdv, tradeFee, creatorBuyIn, minTokensOut],
    }),
  };
  if (isNativeQuote(quoteToken)) return [creatorBuyIn > 0n ? { ...launch, value: creatorBuyIn } : launch];
  return creatorBuyIn > 0n ? [approveCall(quoteToken, launchpad, creatorBuyIn), launch] : [launch];
}

/**
 * The launch transaction, through `executeBatch` — per the repo rule that all
 * user-facing on-chain operations use that single write path (and an ERC-20
 * first buy needs its approval batched in anyway).
 */
export function useLaunchToken() {
  const { isConnected } = useAccount();
  const { executeBatch } = useSmartTransactions();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async ({ name, symbol, metadataURI, quoteToken, startFdv, tradeFee, creatorBuyIn }) => {
      if (!isConnected) throw new Error('Wallet not connected');
      if (!launchpad) throw new Error('No launchpad on this network');

      setError('');

      return executeBatch(
        buildLaunchCalls({ launchpad, name, symbol, metadataURI, quoteToken, startFdv, tradeFee, creatorBuyIn }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokenLaunches'] });
    },
    onError: (e) => {
      setError(e?.shortMessage || e?.message || 'Launch failed');
    },
  });

  return {
    launch: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    txHash: mutation.data,
    error,
    reset: useCallback(() => {
      setError('');
      mutation.reset();
    }, [mutation]),
  };
}

/**
 * Client-side validation mirroring the contract's guards, so a creator learns
 * about a bad name, an out-of-range valuation or trade fee, or a first buy that
 * cannot go through before a wallet prompt rather than from a revert.
 *
 * @param {object} form
 * @param {string} form.name
 * @param {string} form.symbol
 * @param {bigint | null} form.fdv            parsed valuation, quote raw units
 * @param {number | null} form.tradeFee       parsed trade fee, pips (parseTradeFeePct)
 * @param {string} [form.firstBuyInput]       the first-buy field as typed
 * @param {bigint | null} [form.firstBuy]     parsed first buy, quote raw units
 * @param {object} [ctx]
 * @param {{ minFdv: bigint, maxFdv: bigint } | undefined} [ctx.quote]  the selected
 *   quote's bounds; omitted while loading, when the range is not checked
 * @param {number} [ctx.minTradeFee]         the placer's minTradeFee(), pips; omitted while
 *   loading, when only the maximum is checked
 * @param {number} [ctx.maxTradeFee=MAX_TRADE_FEE]  the placer's MAX_TRADE_FEE(), pips
 * @param {boolean} [ctx.hasRouter=true]      a first buy needs TokenLaunchpad.router()
 * @param {bigint | null} [ctx.balance]       the creator's balance of the quote, when known
 * @returns {Record<string, string>} field -> error key (empty when valid)
 */
export function validateLaunchForm({ name, symbol, fdv, tradeFee, firstBuyInput, firstBuy }, ctx = {}) {
  const { quote, minTradeFee, maxTradeFee = MAX_TRADE_FEE, hasRouter = true, balance = null } = ctx;
  /** @type {Record<string, string>} */
  const errors = {};

  const trimmedName = String(name ?? '').trim();
  const trimmedSymbol = String(symbol ?? '').trim();

  if (!trimmedName) errors.name = 'errors.nameRequired';
  else if (utf8Length(trimmedName) > MAX_NAME_LENGTH) errors.name = 'errors.nameTooLong';

  if (!trimmedSymbol) errors.symbol = 'errors.symbolRequired';
  else if (utf8Length(trimmedSymbol) > MAX_SYMBOL_LENGTH) errors.symbol = 'errors.symbolTooLong';

  if (fdv == null) errors.fdv = 'errors.fdvRequired';
  else if (quote) {
    if (fdv < quote.minFdv) errors.fdv = 'errors.fdvTooLow';
    else if (fdv > quote.maxFdv) errors.fdv = 'errors.fdvTooHigh';
  }

  // TradeFeeOutOfRange(tradeFee, minTradeFee, MAX_TRADE_FEE): both bounds inclusive.
  if (tradeFee == null) errors.tradeFee = 'errors.tradeFeeInvalid';
  else if (minTradeFee != null && tradeFee < minTradeFee) errors.tradeFee = 'errors.tradeFeeTooLow';
  else if (tradeFee > maxTradeFee) errors.tradeFee = 'errors.tradeFeeTooHigh';

  // The first buy is optional: empty is fine, anything typed must parse.
  if (String(firstBuyInput ?? '').trim() && firstBuy == null) errors.firstBuy = 'errors.firstBuyInvalid';
  else if (firstBuy != null && firstBuy > 0n) {
    if (!hasRouter) errors.firstBuy = 'errors.firstBuyNoRouter';
    else if (balance != null && firstBuy > balance) errors.firstBuy = 'errors.firstBuyBalance';
  }

  return errors;
}
