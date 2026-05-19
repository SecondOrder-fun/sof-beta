/**
 * Blockscout outbound HTTP client with an LRU cache and an endpoint
 * whitelist. The whitelist exists so the route layer can't be tricked into
 * proxying arbitrary Blockscout paths — every URL we forward is explicitly
 * declared here, with its own TTL.
 *
 * Each endpoint pattern uses `:name` placeholders that match keys in the
 * params object. Remaining params are appended as query string.
 */

const DEFAULT_CACHE_TTLS_MS = {
  'tokens/:address/holders': 5 * 60_000,
  'tokens/:address/transfers': 30_000,
  'addresses/:address/transactions': 30_000,
  // Per-user token transfers — used by /api/sof/transactions/:user to
  // serve the Portfolio SOF Holdings tab without forcing the browser to
  // run its own ERC-20 transfer indexer.
  'addresses/:address/token-transfers': 30_000,
  'transactions/:hash': 5_000,
  'addresses/:address': 60_000,
};

const MAX_CACHE_ENTRIES = 500;

function substitutePath(endpoint, params) {
  const used = new Set();
  const path = endpoint.replace(/:([a-zA-Z]+)/g, (_, name) => {
    if (!(name in params)) {
      throw new Error(`Missing path param ":${name}" for endpoint "${endpoint}"`);
    }
    used.add(name);
    return encodeURIComponent(params[name]);
  });
  const query = Object.entries(params)
    .filter(([k]) => !used.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

function makeCache() {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.expires < Date.now()) {
        map.delete(key);
        return undefined;
      }
      // bump to MRU position
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    set(key, value, ttl) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, expires: Date.now() + ttl });
      while (map.size > MAX_CACHE_ENTRIES) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    size() { return map.size; },
  };
}

export function createBlockscoutClient({ baseUrl, apiKey, logger, cacheTtlsMs }) {
  if (!baseUrl) throw new Error('blockscoutClient: baseUrl is required');
  if (!apiKey) throw new Error('blockscoutClient: apiKey is required');
  const ttls = { ...DEFAULT_CACHE_TTLS_MS, ...(cacheTtlsMs || {}) };
  const allowed = new Set(Object.keys(ttls));
  const cache = makeCache();

  async function fetchFn(endpoint, params) {
    if (!allowed.has(endpoint)) {
      throw new Error(`Endpoint not in whitelist: ${endpoint}`);
    }
    const subpath = substitutePath(endpoint, params);
    const cacheKey = `${endpoint}::${subpath}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      logger.debug(`[BLOCKSCOUT] cache hit ${endpoint}`);
      return cached;
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/v2/${subpath}`;
    const headers = { Accept: 'application/json' };
    headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`[BLOCKSCOUT] ${res.status} ${endpoint}: ${body.slice(0, 200)}`);
      const err = new Error(`Blockscout ${res.status} ${res.statusText}: ${endpoint}`);
      err.status = res.status;
      err.retryable = res.status >= 500 || res.status === 429;
      throw err;
    }
    const json = await res.json();
    cache.set(cacheKey, json, ttls[endpoint]);
    return json;
  }

  return { fetch: fetchFn, cacheSize: () => cache.size() };
}
