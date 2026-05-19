// src/lib/viemClient.js
// Shared viem client helpers with RPC fallback support.

import { createPublicClient, fallback, http } from "viem";
import { getNetworkByKey } from "@/config/networks";

const DEMOTION_WINDOW_MS = 5 * 60 * 1000;
const RESET_INTERVAL_MS = 10 * 60 * 1000;
const badRpcUrls = new Map();
let lastResetAt = Date.now();
// sepolia.base.org is the public Base Sepolia RPC. It does NOT serve the
// Access-Control-Allow-Origin header for browser requests, so any URL that
// reaches this host from the frontend produces a CORS error in the console.
// Per CLAUDE.md, Tenderly is the canonical RPC. Prefer to filter
// sepolia.base.org out of transport lists — but never strip it down to an
// empty list, since that breaks bootstrap when the deploy env has it as the
// sole configured URL. Filter when alternatives exist; otherwise fall through
// with a warning.
const PROBLEMATIC_RPC_HOSTS = ["sepolia.base.org"];

function isProblematicRpcUrl(url) {
  if (!url) return false;
  return PROBLEMATIC_RPC_HOSTS.some((host) => url.includes(host));
}

/**
 * Reset any demoted RPC URLs (e.g., page reload or timed reset).
 */
export function resetBadRpcUrls() {
  badRpcUrls.clear();
  lastResetAt = Date.now();
  invalidateClientCache();
}

function maybeResetDemotions(now) {
  if (now - lastResetAt >= RESET_INTERVAL_MS) {
    resetBadRpcUrls();
  }
}

function markRpcBad(url, now) {
  badRpcUrls.set(url, now + DEMOTION_WINDOW_MS);
  // Bust the client cache so the next buildPublicClient call constructs
  // a fresh client with the demoted URL stripped from its transport list.
  invalidateClientCache();
}

function isRpcBad(url, now) {
  const until = badRpcUrls.get(url);
  if (!until) return false;
  if (now >= until) {
    badRpcUrls.delete(url);
    return false;
  }
  return true;
}

// Module-level client cache, keyed by (networkKey, active-URL set).
// Critical: every caller of buildPublicClient(netKey) must get the SAME
// client instance, otherwise each gets its own batch.multicall queue and
// concurrent reads from different consumers can't share the aggregator —
// they fire as parallel POSTs and saturate the gateway's burst limit.
// The cache invalidates when the active URL set changes (e.g. after an
// RPC gets demoted by markRpcBad), since transport state is baked in.
const clientCache = new Map();

function invalidateClientCache() {
  clientCache.clear();
}

/**
 * Build (or reuse) the shared viem public client for the given network.
 * Returns null when the network has no rpcUrl configured.
 *
 * @param {string} networkKey
 * @returns {import("viem").PublicClient | null}
 */
export function buildPublicClient(networkKey) {
  const now = Date.now();
  const willReset = now - lastResetAt >= RESET_INTERVAL_MS;
  maybeResetDemotions(now);
  if (willReset) invalidateClientCache();
  const net = getNetworkByKey(networkKey);
  const fallbackUrls = net?.rpcFallbackUrls || [];
  const primaryRpcUrl = net?.rpcUrl || "";
  const primaryUrl = [primaryRpcUrl, ...fallbackUrls]
    .filter((url) => typeof url === "string")
    .map((url) => url.trim())
    .find((url) => url.startsWith("http"));

  if (!primaryUrl) return null;

  const chain = {
    id: net.id,
    name: net.name,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [primaryUrl] },
      public: { http: [primaryUrl] },
    },
    // Multicall3 is deployed at the universal address on every modern chain
    // (Base Sepolia included). Declaring it lets viem's batch.multicall
    // aggregator (enabled below in createPublicClient) collapse N concurrent
    // readContract calls into one aggregate3 call against this contract.
    contracts: {
      multicall3: {
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      },
    },
  };

  const rawUrls = [primaryRpcUrl, ...fallbackUrls]
    .filter((url) => typeof url === "string")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("http"));
  if (rawUrls.length === 0) return null;
  const cleanUrls = rawUrls.filter((url) => !isProblematicRpcUrl(url));
  // If filtering would remove every URL, fall through with the raw list and
  // a warning rather than returning null (which silently disables features).
  const allUrls = cleanUrls.length > 0 ? cleanUrls : rawUrls;
  if (cleanUrls.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[buildPublicClient] all configured RPC URLs are on the problematic-host list (${PROBLEMATIC_RPC_HOSTS.join(", ")}). ` +
        `Update VITE_RPC_URL/rpcFallbackUrls to a CORS-friendly endpoint. Falling back to the raw list — expect CORS errors.`,
    );
  }
  const activeUrls = allUrls.filter((url) => !isRpcBad(url, now));
  const urlsToUse = activeUrls.length > 0 ? activeUrls : allUrls;
  if (urlsToUse.length === 0) return null;

  // Cache hit when the same network + same active-URL set is requested.
  // Active URL set is part of the key so a demotion forces a rebuild.
  const cacheKey = `${networkKey}::${urlsToUse.join(",")}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const httpTransports = urlsToUse
    .map((url) =>
      http(url, {
        // batch: true coalesces RPC calls issued in the same microtask into
        // a single HTTP POST. Without it every readContract / multicall is
        // its own request and a busy page exhausts Tenderly rate limits in
        // seconds.
        //
        // retryCount: 0 disables viem's transport-level retry entirely.
        // viem retries on 4xx/5xx by default, but for our use case 429 is
        // the dominant failure mode and an automatic retry just doubles
        // the rate-limit pressure on the gateway — the second attempt
        // lands inside the same rolling window and 429s again. react-query
        // sits above this and applies its own retry with exponential
        // backoff if a query really needs a second try.
        batch: true,
        retryCount: 0,
        onFetchResponse(response) {
          if (response.status === 403 || response.status === 429) {
            markRpcBad(url, Date.now());
            throw new Error(`RPC ${url} responded with ${response.status}`);
          }
          if (response.status >= 500) {
            markRpcBad(url, Date.now());
            throw new Error(`RPC ${url} responded with ${response.status}`);
          }
        },
      }),
    )
    .filter((transport) => typeof transport === "function");

  if (httpTransports.length === 0) return null;

  const transport =
    httpTransports.length > 1
      ? fallback(httpTransports, { rank: false })
      : httpTransports[0];

  // batch.multicall collects readContract calls fired across the same render
  // window into a single multicall3.aggregate3 — without this, every read
  // from this client (onchainRaffleDistributor, BuySellWidget price-estimate,
  // usePlayerPosition.refreshNow) goes out as its own POST and a busy page
  // burns the Tenderly free-tier 25-rps burst limit on mount. wagmi's
  // built-in public client gets multicall by default; this standalone client
  // does not, so set it explicitly. wait: 50ms covers ~3 React render passes
  // — initial mount + first dependent re-renders typically land within that
  // envelope (e.g. usePlayerPosition's playerTickets fires on mount, then
  // curveConfig fires once SMA resolves a tick later). Smaller windows
  // (16ms) leaked into separate POSTs and tripped 429s.
  const client = createPublicClient({
    chain,
    transport,
    batch: { multicall: { wait: 50 } },
  });
  clientCache.set(cacheKey, client);
  return client;
}
