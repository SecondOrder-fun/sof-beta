// src/lib/launchQuote.js
//
// Symbol and decimals for the quote tokens launches are paired with, for hooks
// that only know an address (a launch record, a pool key). Listed quotes
// (config/launchQuoteTokens.js) need no read; anything else is read from the
// token itself, so a quote added to the launchpad's allowlist before this
// frontend lists it still formats correctly.

import { ERC20Abi } from '@/utils/abis';
import { findLaunchQuote, isNativeQuote, ETH_QUOTE } from '@/config/launchQuoteTokens';

/**
 * @param {import('viem').PublicClient} client
 * @param {string[]} addresses  quote addresses, any case, duplicates fine
 * @param {string | undefined} networkKey
 * @returns {Promise<Record<string, import('@/config/launchQuoteTokens').LaunchQuote>>}
 *   keyed by lowercased address; ETH is keyed by the zero address
 */
export async function resolveQuoteMeta(client, addresses, networkKey) {
  /** @type {Record<string, import('@/config/launchQuoteTokens').LaunchQuote>} */
  const out = {};
  const unknown = [];
  for (const raw of addresses) {
    const address = isNativeQuote(raw) ? ETH_QUOTE.address : String(raw);
    const key = address.toLowerCase();
    if (out[key] || unknown.includes(address)) continue;
    const listed = findLaunchQuote(address, networkKey);
    if (listed) out[key] = listed;
    else unknown.push(address);
  }
  if (!unknown.length) return out;

  const reads = await client.multicall({
    contracts: unknown.flatMap((address) => [
      { address, abi: ERC20Abi, functionName: 'symbol' },
      { address, abi: ERC20Abi, functionName: 'decimals' },
    ]),
    allowFailure: true,
  });
  unknown.forEach((address, i) => {
    const symbol = reads[i * 2];
    const decimals = reads[i * 2 + 1];
    out[address.toLowerCase()] = {
      address,
      symbol: symbol?.status === 'success' ? symbol.result : '',
      // A token that will not say is formatted as 18-decimal, the ERC-20 norm.
      decimals: decimals?.status === 'success' ? Number(decimals.result) : 18,
    };
  });
  return out;
}

/**
 * The resolved entry for one address from resolveQuoteMeta's map.
 * @param {Record<string, import('@/config/launchQuoteTokens').LaunchQuote>} meta
 * @param {string | undefined} address
 */
export function quoteMetaFor(meta, address) {
  if (isNativeQuote(address)) return ETH_QUOTE;
  return meta[String(address).toLowerCase()] ?? { address, symbol: '', decimals: 18 };
}
