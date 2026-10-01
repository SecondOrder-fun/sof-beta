// src/lib/launchSort.js
// Sorting and search for the discovery feed. Pure, so it is testable without
// rendering, and kept out of the route so the route module only exports a component.

export const SORTS = ['new', 'climb', 'fdv', 'sellout'];

const key = (l) => l.token.toLowerCase();

/**
 * Match name, symbol (with or without `$`) or address, case-insensitively.
 * @param {object[]} launches
 * @param {string} query
 */
export function filterLaunches(launches, query) {
  const q = String(query ?? '').trim().toLowerCase().replace(/^\$/, '');
  if (!q) return launches;
  return launches.filter(
    (l) =>
      (l.name || '').toLowerCase().includes(q) ||
      (l.symbol || '').toLowerCase().includes(q) ||
      l.token.toLowerCase().includes(q),
  );
}

/**
 * Order the feed.
 *
 *   new     — newest launch first (the chain's own order)
 *   climb   — largest multiple since launch
 *   fdv     — largest current valuation
 *   sellout — most supply sold, i.e. nearest the top of its range
 *
 * Tokens not yet priced (their market read has not landed) sort last under
 * every market-based order, rather than as if they were worth zero.
 *
 * @param {object[]} launches
 * @param {Record<string, object>} markets keyed by lowercased token
 * @param {string} sort
 */
export function sortLaunches(launches, markets, sort) {
  const list = [...launches];
  if (sort === 'new' || !SORTS.includes(sort)) {
    return list.sort((a, b) => Number(b.launchedAt ?? 0) - Number(a.launchedAt ?? 0));
  }

  const metric = (l) => {
    const m = markets[key(l)];
    if (!m) return null;
    if (sort === 'climb') return m.multiple;
    if (sort === 'sellout') return m.soldFraction;
    return Number(m.fdvWei); // 'fdv' — ordering only, so float precision is fine
  };

  return list.sort((a, b) => {
    const ma = metric(a);
    const mb = metric(b);
    if (ma == null && mb == null) return 0;
    if (ma == null) return 1;
    if (mb == null) return -1;
    return mb - ma;
  });
}
