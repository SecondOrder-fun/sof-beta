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
}

function maybeResetDemotions(now) {
  if (now - lastResetAt >= RESET_INTERVAL_MS) {
    resetBadRpcUrls();
  }
}

function markRpcBad(url, now) {
  badRpcUrls.set(url, now + DEMOTION_WINDOW_MS);
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

/**
 * Build a viem public client with RPC fallback support.
 * Returns null when the network has no rpcUrl configured.
 * @param {string} networkKey
 * @returns {import("viem").PublicClient | null}
 */
export function buildPublicClient(networkKey) {
  const now = Date.now();
  maybeResetDemotions(now);
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

  const httpTransports = urlsToUse
    .map((url) =>
      http(url, {
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

  return createPublicClient({ chain, transport });
}
