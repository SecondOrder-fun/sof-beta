// src/lib/launchTrade.js
//
// Build the calls for a launched-token trade.
//
// Encoded against ILaunchRouter — the interface, never an implementation's ABI.
// The router address itself comes from TokenLaunchpad.router(), so swapping the
// router (ours for another, or an adapter over Uniswap's) changes nothing here.
// That is the switch: one setRouter transaction, no client release.
//
// Every launch trades against its own quote token (TokenLaunchpad.quoteTokenOf):
//   - ETH-paired buy: one payable call, `value` = quoteIn.
//   - ERC-20-paired buy: approve the ROUTER for quoteIn, then buy with no ETH —
//     the router pulls only what the pool fills.
//   - Sell (either pairing): approve the router for the tokens, then sell; the
//     proceeds arrive in the launch's quote.

import { encodeFunctionData } from 'viem';
import { ERC20Abi, ILaunchRouterAbi } from '@/utils/abis';
import { isNativeQuote } from '@/config/launchQuoteTokens';

/** How long a signed trade stays valid. Long enough for a wallet prompt, short enough to bound staleness. */
export const TRADE_DEADLINE_SECONDS = 20 * 60;

/** An ERC-20 approve call, for a batch that spends the approved amount next. */
export const approveCall = (token, spender, amount) => ({
  to: token,
  data: encodeFunctionData({ abi: ERC20Abi, functionName: 'approve', args: [spender, amount] }),
});

/**
 * @param {object} p
 * @param {'buy'|'sell'} p.side
 * @param {`0x${string}`} p.router       from TokenLaunchpad.router()
 * @param {`0x${string}`} p.token
 * @param {`0x${string}`} [p.quoteToken] the launch's quote; address 0 (or omitted) is ETH
 * @param {bigint} p.amountIn            raw quote units (buy) or raw token units (sell)
 * @param {bigint} p.minOut              tokens (buy) or raw quote units (sell), after slippage
 * @param {`0x${string}`} p.recipient    the account the trade settles to
 * @param {number} [p.nowSec]            for tests
 * @returns {{ to: `0x${string}`, data: `0x${string}`, value?: bigint }[]}
 */
export function buildTradeCalls({ side, router, token, quoteToken, amountIn, minOut, recipient, nowSec }) {
  if (!router) throw new Error('No router is set for in-app trading');
  if (!amountIn || amountIn <= 0n) throw new Error('Amount must be positive');
  const deadline = BigInt((nowSec ?? Math.floor(Date.now() / 1000)) + TRADE_DEADLINE_SECONDS);

  if (side === 'buy') {
    const buy = {
      to: router,
      data: encodeFunctionData({
        abi: ILaunchRouterAbi,
        functionName: 'buy',
        args: [token, amountIn, minOut, recipient, deadline],
      }),
    };
    if (isNativeQuote(quoteToken)) return [{ ...buy, value: amountIn }];
    // ERC-20 quote: the router pulls it, so approve first — both in one batch.
    return [approveCall(quoteToken, router, amountIn), buy];
  }

  // A sell spends tokens the router pulls, so approve it first — both in one batch.
  return [
    approveCall(token, router, amountIn),
    {
      to: router,
      data: encodeFunctionData({
        abi: ILaunchRouterAbi,
        functionName: 'sell',
        args: [token, amountIn, minOut, recipient, deadline],
      }),
    },
  ];
}
