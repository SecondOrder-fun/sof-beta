// src/hooks/useQuoteTokenChoice.js
//
// The "Priced in" choice on the create-season forms: which token a new season's
// tickets, prize pool and InfoFi markets use. It cannot change after creation.
//
// Options come in three groups, in order: the connected account's own launches
// (creator = its EOA or smart account), the tokens the platform has approved
// (at least the platform default, contracts.QUOTE_TOKEN), and the newest
// launches not already listed. Any other token can be pasted by address; a
// pasted token — or one handed in from `?quoteToken=` — is checked the way the
// contract checks it (useQuoteTokenInfo) and blocks submission until it passes.
//
// Hooks return data; the picker (components/admin/QuoteTokenPicker) words it.

import { useCallback, useMemo, useState } from 'react';
import { getAddress, isAddress } from 'viem';
import { useAccount } from 'wagmi';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { useRaffleAccount } from '@/hooks/useRaffleAccount';
import { useTokenLaunch, useTokenLaunches } from '@/hooks/useTokenLaunches';
import { useLaunchMarkets } from '@/hooks/useLaunchMarkets';
import { useQuoteTokenInfo } from '@/hooks/useQuoteTokenInfo';

/** How many of the newest launches the list offers. */
export const NEWEST_LAUNCH_OPTIONS = 8;

/** Launch tokens are plain 18-decimal ERC-20s (the launchpad mints 1e9 * 1e18). */
const LAUNCH_DECIMALS = 18;

const lower = (a) => (a ? a.toLowerCase() : '');

/**
 * @typedef {Object} QuoteTokenOption
 * @property {string} address
 * @property {string} name
 * @property {string} symbol
 * @property {number} decimals
 * @property {'launch' | 'approved'} kind
 * @property {boolean} [isPlatformDefault]
 * @property {bigint} [launchedAt]      launch tokens: unix seconds
 * @property {bigint | null} [fdvWei]   launch tokens: live FDV, when the pool is priced
 * @property {bigint | null} [priceWei] launch tokens: live wei of ETH per whole token
 */

/**
 * Status of the current choice:
 *   'eligible'   — a token is chosen and may price a season
 *   'checking'   — a pasted token's eligibility read is in flight
 *   'ineligible' — the pasted token is neither launched here nor approved
 *   'invalid'    — the pasted text is not an address
 *   'error'      — the eligibility read failed
 *   'none'       — nothing chosen and no platform default configured
 * Everything but 'eligible' and 'none' blocks submission; with 'none' the
 * write falls back to its own default (useRaffleWrite).
 */

/**
 * @param {{ initialToken?: string | null }} [options]
 *   a token to preselect (e.g. from `?quoteToken=`); checked like a paste
 */
export function useQuoteTokenChoice({ initialToken } = {}) {
  const contracts = getContractAddresses(getStoredNetworkKey());
  const platformToken = contracts.QUOTE_TOKEN || '';

  const { address: connected } = useAccount();
  const { eoa, sma } = useRaffleAccount();
  const { launches, isLoading: launchesLoading } = useTokenLaunches();

  // A list pick; null = the platform default.
  const [picked, setPicked] = useState(null);
  // Pasted text governs while it is non-empty. The preselected token starts
  // here, so it goes through the same check and shows where it came from.
  const [pasteText, setPasteText] = useState(() => (initialToken ? String(initialToken) : ''));

  const pasteTrimmed = pasteText.trim();
  const pasteValid = pasteTrimmed !== '' && isAddress(pasteTrimmed, { strict: false });
  const pasteAddress = pasteValid ? getAddress(lower(pasteTrimmed)) : undefined;

  const platformInfo = useQuoteTokenInfo(platformToken || undefined);
  const pasteInfo = useQuoteTokenInfo(pasteAddress);
  // A pasted launch token older than the page of launches still gets priced.
  const { data: pastedLaunch } = useTokenLaunch(pasteInfo.data?.kind === 'launch' ? pasteAddress : undefined);

  const priceable = useMemo(() => {
    const seen = new Set(launches.map((l) => lower(l.token)));
    return pastedLaunch && !seen.has(lower(pastedLaunch.token)) ? [...launches, pastedLaunch] : launches;
  }, [launches, pastedLaunch]);
  const { markets } = useLaunchMarkets(priceable);

  const groups = useMemo(() => {
    const mine = new Set([connected, eoa, sma].filter(Boolean).map(lower));
    const launchOption = (l) => {
      const market = markets[lower(l.token)];
      return {
        address: l.token,
        name: l.name,
        symbol: l.symbol,
        decimals: LAUNCH_DECIMALS,
        kind: 'launch',
        launchedAt: l.launchedAt,
        fdvWei: market?.fdvWei ?? null,
        priceWei: market?.priceWei ?? null,
      };
    };

    const yours = launches.filter((l) => mine.has(lower(l.creator))).map(launchOption);
    const listed = new Set(yours.map((o) => lower(o.address)));
    const approved =
      platformToken && !listed.has(lower(platformToken))
        ? [
            {
              address: platformToken,
              name: platformInfo.data?.name ?? '',
              symbol: platformInfo.data?.symbol ?? '',
              decimals: platformInfo.data?.decimals ?? 18,
              kind: 'approved',
              isPlatformDefault: true,
            },
          ]
        : [];
    approved.forEach((o) => listed.add(lower(o.address)));
    const newest = launches
      .filter((l) => !listed.has(lower(l.token)))
      .slice(0, NEWEST_LAUNCH_OPTIONS)
      .map(launchOption);

    return { yours, approved, newest };
  }, [launches, markets, connected, eoa, sma, platformToken, platformInfo.data]);

  const options = useMemo(() => [...groups.yours, ...groups.approved, ...groups.newest], [groups]);
  const findOption = useCallback(
    (address) => options.find((o) => lower(o.address) === lower(address)) ?? null,
    [options],
  );

  let status;
  let selected = null;
  let source;
  if (pasteTrimmed) {
    source = 'paste';
    if (!pasteValid) status = 'invalid';
    else if (pasteInfo.isError) status = 'error';
    else if (!pasteInfo.data) status = 'checking';
    else if (!pasteInfo.data.eligible) status = 'ineligible';
    else {
      status = 'eligible';
      const listedOption = findOption(pasteAddress);
      const market = markets[lower(pasteAddress)];
      selected = {
        address: pasteAddress,
        name: pasteInfo.data.name,
        symbol: pasteInfo.data.symbol,
        decimals: pasteInfo.data.decimals,
        kind: pasteInfo.data.kind,
        isPlatformDefault: lower(pasteAddress) === lower(platformToken),
        launchedAt: listedOption?.launchedAt ?? pastedLaunch?.launchedAt,
        fdvWei: market?.fdvWei ?? null,
        priceWei: market?.priceWei ?? null,
      };
    }
  } else {
    source = picked ? 'list' : 'default';
    // Every listed option is eligible by construction. A pick that has since
    // fallen out of the refreshed list keeps its address.
    selected =
      findOption(picked || platformToken) ??
      (picked ? { address: picked, name: '', symbol: '', decimals: LAUNCH_DECIMALS, kind: 'launch' } : null);
    status = selected ? 'eligible' : 'none';
  }

  const selectFromList = useCallback((address) => {
    setPicked(address);
    setPasteText('');
  }, []);

  return {
    groups,
    selected,
    /** The address to create the season with; undefined = the write's default. */
    quoteToken: status === 'eligible' ? selected?.address : undefined,
    status,
    source,
    blocked: status !== 'eligible' && status !== 'none',
    pasteText,
    setPasteText,
    selectFromList,
    isLoading: launchesLoading,
  };
}
