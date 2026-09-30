// src/hooks/useQuoteTokenInfo.js
//
// Whether a token may price a new season, and what to call it.
//
// The rule is the contract's own (Raffle.isAllowedQuoteToken): a token is
// allowed when the platform has approved it (Raffle.allowedQuoteTokens) or the
// launchpad launched it (TokenLaunchpad.isLaunchToken). Checking it here, before
// the transaction, means the create-season forms never send one that reverts
// with QuoteTokenNotAllowed. One multicall: both eligibility reads plus the
// token's ERC-20 name, symbol and decimals.

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses, RAFFLE_ABI } from '@/config/contracts';
import { ERC20Abi, TokenLaunchpadAbi } from '@/utils/abis';

/**
 * @typedef {Object} QuoteTokenInfo
 * @property {boolean} eligible            — may price a new season
 * @property {'launch' | 'approved' | null} kind — why it is eligible; null when it is not
 * @property {string} name
 * @property {string} symbol
 * @property {number} decimals
 */

/**
 * Reads a token's eligibility and metadata. Throws when an eligibility read
 * fails: "could not check" must not read as "not allowed", or as allowed.
 *
 * @param {{ multicall: Function }} client
 * @param {{ raffle: string, launchpad?: string }} contracts
 *   `launchpad` empty = launch tokens are not accepted, as on-chain with none set
 * @param {string} token
 * @returns {Promise<QuoteTokenInfo>}
 */
export async function readQuoteTokenInfo(client, { raffle, launchpad }, token) {
  const calls = [
    { address: raffle, abi: RAFFLE_ABI, functionName: 'allowedQuoteTokens', args: [token] },
    { address: token, abi: ERC20Abi, functionName: 'name' },
    { address: token, abi: ERC20Abi, functionName: 'symbol' },
    { address: token, abi: ERC20Abi, functionName: 'decimals' },
  ];
  if (launchpad) {
    calls.push({ address: launchpad, abi: TokenLaunchpadAbi, functionName: 'isLaunchToken', args: [token] });
  }

  const [approvedRes, nameRes, symbolRes, decimalsRes, launchRes] = await client.multicall({
    contracts: calls,
    allowFailure: true,
  });
  if (approvedRes?.status !== 'success' || (launchpad && launchRes?.status !== 'success')) {
    throw new Error('Could not check whether this token may price a season');
  }

  const isLaunch = Boolean(launchpad) && launchRes.result === true;
  const isApproved = approvedRes.result === true;
  return {
    eligible: isLaunch || isApproved,
    kind: isLaunch ? 'launch' : isApproved ? 'approved' : null,
    name: nameRes?.status === 'success' ? nameRes.result : '',
    symbol: symbolRes?.status === 'success' ? symbolRes.result : '',
    decimals: decimalsRes?.status === 'success' ? Number(decimalsRes.result) : 18,
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
