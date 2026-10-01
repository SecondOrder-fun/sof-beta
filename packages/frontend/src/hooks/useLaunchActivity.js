// src/hooks/useLaunchActivity.js
//
// Backend reads for the launchpad's live surfaces, all through the warm tier
// (see useWarmRead):
//
//   useActivityFeed   — GET /api/activity: the ticker's tokens and raffles rows
//   useTokenChart     — GET /api/launchpad/tokens/:address/chart
//   useTokenSeasons   — GET /api/launchpad/tokens/:address/seasons
//   useRaffleBadges   — GET /api/launchpad/raffles?tokens=: one badge per card
//
// These have no on-chain fallback: they are built from indexed history, which
// the chain cannot answer in one read. Callers render nothing (ticker, badge)
// or an honest empty state (chart, card) when the backend has no data.

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
