// src/hooks/useQuoteTokenInfo.js
//
// Whether a token may price a new season, and what to call it.
//
// The answer is the contract's own: Raffle.isAllowedQuoteToken (approved by the
// platform, or launched by the launchpad the Raffle is wired to), plus the
// 18-decimals rule createSeason also enforces (QuoteTokenDecimals /
// QuoteTokenDecimalsUnavailable). Asking the Raffle itself, rather than
// re-deriving the rule from the deployment's launchpad, means the check and the
// transaction cannot disagree. Checking it before the transaction means the
// create-season forms never send one that reverts. One multicall: eligibility,
// whether it is a launch token (for the label only), and the ERC-20 metadata.

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses, RAFFLE_ABI } from '@/config/contracts';
import { ERC20Abi, TokenLaunchpadAbi } from '@/utils/abis';

/**
 * @typedef {Object} QuoteTokenInfo
 * @property {boolean} eligible            — may price a new season
 * @property {'notAllowed' | 'decimals' | null} reason — why not; null when eligible
 * @property {'launch' | 'approved' | null} kind — how it is allowed; null when it is not
 * @property {string} name
 * @property {string} symbol
 * @property {number | null} decimals      — null when the token does not report any
 */

/** Tickets are 0-decimal and the curve prices in 18-decimal units; Raffle rejects others. */
export const QUOTE_TOKEN_DECIMALS = 18;

/**
 * Reads a token's eligibility and metadata. Throws when the eligibility read
 * fails: "could not check" must not read as "not allowed", or as allowed.
 *
 * @param {{ multicall: Function }} client
 * @param {{ raffle: string, launchpad?: string }} contracts
 *   `launchpad` only labels an allowed token as a launch token; it does not decide
 * @param {string} token
 * @returns {Promise<QuoteTokenInfo>}
 */
export async function readQuoteTokenInfo(client, { raffle, launchpad }, token) {
  const calls = [
    { address: raffle, abi: RAFFLE_ABI, functionName: 'isAllowedQuoteToken', args: [token] },
    { address: token, abi: ERC20Abi, functionName: 'name' },
    { address: token, abi: ERC20Abi, functionName: 'symbol' },
    { address: token, abi: ERC20Abi, functionName: 'decimals' },
  ];
  if (launchpad) {
    calls.push({ address: launchpad, abi: TokenLaunchpadAbi, functionName: 'isLaunchToken', args: [token] });
  }

  const [allowedRes, nameRes, symbolRes, decimalsRes, launchRes] = await client.multicall({
    contracts: calls,
    allowFailure: true,
  });
  if (allowedRes?.status !== 'success') {
    throw new Error('Could not check whether this token may price a season');
  }

  const allowed = allowedRes.result === true;
  const decimals = decimalsRes?.status === 'success' ? Number(decimalsRes.result) : null;
  const isLaunch = launchRes?.status === 'success' && launchRes.result === true;
  const reason = !allowed ? 'notAllowed' : decimals !== QUOTE_TOKEN_DECIMALS ? 'decimals' : null;
  return {
    eligible: reason === null,
    reason,
    kind: allowed ? (isLaunch ? 'launch' : 'approved') : null,
    name: nameRes?.status === 'success' ? nameRes.result : '',
    symbol: symbolRes?.status === 'success' ? symbolRes.result : '',
    decimals,
  };
}

/**
 * @param {string | undefined} token  a valid address, or undefined to read nothing
 * @returns the react-query result; `data` is a QuoteTokenInfo
 */
export function useQuoteTokenInfo(token) {
  const client = usePublicClient();
  const { RAFFLE, TOKEN_LAUNCHPAD } = getContractAddresses(getStoredNetworkKey());

  return useQuery({
    queryKey: ['quoteTokenInfo', RAFFLE, TOKEN_LAUNCHPAD, token?.toLowerCase()],
    enabled: Boolean(client && RAFFLE && token),
    // Approval can change, but not within the life of a form.
    staleTime: 60_000,
    retry: 1,
    queryFn: () => readQuoteTokenInfo(client, { raffle: RAFFLE, launchpad: TOKEN_LAUNCHPAD }, token),
  });
}
