// src/lib/launchTrade.js
//
// Build the calls for a launched-token trade.
//
// Encoded against ILaunchRouter — the interface, never an implementation's ABI.
// The router address itself comes from TokenLaunchpad.router(), so swapping the
// router (ours for another, or an adapter over Uniswap's) changes nothing here.
// That is the switch: one setRouter transaction, no client release.

import { encodeFunctionData } from 'viem';
import { ERC20Abi, ILaunchRouterAbi } from '@/utils/abis';

/** How long a signed trade stays valid. Long enough for a wallet prompt, short enough to bound staleness. */
export const TRADE_DEADLINE_SECONDS = 20 * 60;

/**
 * @param {object} p
 * @param {'buy'|'sell'} p.side
 * @param {`0x${string}`} p.router     from TokenLaunchpad.router()
 * @param {`0x${string}`} p.token
 * @param {bigint} p.amountIn          wei of ETH (buy) or raw token units (sell)
 * @param {bigint} p.minOut            tokens (buy) or wei (sell), after slippage
 * @param {`0x${string}`} p.recipient  the account the trade settles to
 * @param {number} [p.nowSec]          for tests
 * @returns {{ to: `0x${string}`, data: `0x${string}`, value?: bigint }[]}
 */
export function buildTradeCalls({ side, router, token, amountIn, minOut, recipient, nowSec }) {
  if (!router) throw new Error('No router is set for in-app trading');
  if (!amountIn || amountIn <= 0n) throw new Error('Amount must be positive');
  const deadline = BigInt((nowSec ?? Math.floor(Date.now() / 1000)) + TRADE_DEADLINE_SECONDS);

  if (side === 'buy') {
    return [
      {
        to: router,
        data: encodeFunctionData({
          abi: ILaunchRouterAbi,
          functionName: 'buy',
          args: [token, minOut, recipient, deadline],
        }),
        value: amountIn,
      },
    ];
  }

  // A sell spends tokens the router pulls, so approve it first — both in one batch.
  return [
    {
      to: token,
      data: encodeFunctionData({ abi: ERC20Abi, functionName: 'approve', args: [router, amountIn] }),
    },
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
