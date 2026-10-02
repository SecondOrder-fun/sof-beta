// src/hooks/useLaunchActivity.js
//
// Backend reads for the launchpad's live surfaces, all through the warm tier
// (see useWarmRead):
//
//   useActivityFeed   — GET /api/activity: the ticker's tokens and raffles rows
//   useTokenChart     — GET /api/launchpad/tokens/:address/chart
//   useTokenSeasons   — GET /api/launchpad/tokens/:address/seasons
//   useRaffleBadges   — GET /api/launchpad/raffles?tokens=: one badge per card
//   useCreatorLaunches — GET /api/launchpad/tokens?creator=: the launches an
//                       account created, for the profile's creator fees
//
// These have no on-chain fallback: they are built from indexed history, which
// the chain cannot answer in one read. Callers render nothing (ticker, badge,
// creator fees) or an honest empty state (chart, card) when the backend has no data.

import { keepPreviousData } from '@tanstack/react-query';
import { useWarmRead } from '@/hooks/chain/useWarmRead';

export function useActivityFeed({ enabled = true } = {}) {
  return useWarmRead({ path: '/activity', enabled, refetchInterval: 15_000, staleTime: 10_000 });
}

/**
 * @param {string | undefined} token
 * @param {'1h'|'6h'|'24h'|'all'} range
 */
export function useTokenChart(token, range) {
  return useWarmRead({
    path: '/launchpad/tokens/:address/chart',
    params: { address: token?.toLowerCase() ?? '', range },
    enabled: Boolean(token),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** @param {string | undefined} token */
export function useTokenSeasons(token) {
  return useWarmRead({
    path: '/launchpad/tokens/:address/seasons',
    params: { address: token?.toLowerCase() ?? '' },
    enabled: Boolean(token),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * Badges for a page of token cards, in one request.
 * @param {string[]} tokens
 * @returns {Record<string, object>} lowercased token -> featured season summary
 */
export function useRaffleBadges(tokens) {
  // The first 100 in the caller's order (the feed's newest first, so a cap drops the
  // oldest cards' badges, never the newest), then sorted so the same set in a
  // different order hits the same cache entry.
  const list = [...new Set((tokens ?? []).map((t) => t.toLowerCase()))].slice(0, 100).sort();
  const { data } = useWarmRead({
    path: '/launchpad/raffles',
    params: { tokens: list.join(',') },
    enabled: list.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
    // "Load more" grows the list and so the key; keep the current badges on screen
    // until the bigger request returns instead of blanking every card.
    placeholderData: keepPreviousData,
  });
  return data?.raffles ?? {};
}

/** Launches per creator read; the route's own cap. */
export const CREATOR_LAUNCHES_LIMIT = 100;

const EMPTY_LAUNCHES = [];

/**
 * The launches the connected wallet created, newest first — the profile's
 * creator-fees list.
 *
 * Indexed by creator, so it misses a launch whose fees another creator handed to
 * this account (setFeeRecipient): the placer records no index of recipients and
 * the backend does not index FeeRecipientUpdated yet. That launch's fees still
 * show on its token page. Also capped at CREATOR_LAUNCHES_LIMIT.
 *
 * @param {string | undefined} creator  the connected wallet address
 * @returns {{ launches: object[], isLoading: boolean, isError: boolean }}
 *   launches in the backend's API shape (token, name, symbol, poolId, creator…)
 */
export function useCreatorLaunches(creator) {
  const creatorLc = creator ? creator.toLowerCase() : undefined;
  const read = useWarmRead({
    path: '/launchpad/tokens',
    params: { creator: creatorLc ?? '', limit: CREATOR_LAUNCHES_LIMIT },
    enabled: Boolean(creatorLc),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return {
    launches: read.data?.launches ?? EMPTY_LAUNCHES,
    isLoading: read.isLoading,
    isError: read.isError,
  };
}
