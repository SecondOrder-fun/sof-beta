// src/lib/viemClient.js
// Shared viem client helpers with RPC fallback support.

import { createPublicClient, fallback, http } from "viem";
import { getNetworkByKey } from "@/config/networks";

const DEMOTION_WINDOW_MS = 5 * 60 * 1000;
const RESET_INTERVAL_MS = 10 * 60 * 1000;
const badRpcUrls = new Map();
let lastResetAt = Date.now();
const SEPOLIA_BASE_HOST = "sepolia.base.org";

function allowRpcUrl(url) {
  if (!url) return false;
  if (url.includes(SEPOLIA_BASE_HOST)) {
    return (import.meta.env.VITE_RPC_URL_TESTNET || "").includes(
      SEPOLIA_BASE_HOST,
    );
  }
  return true;
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

  const allUrls = [primaryRpcUrl, ...fallbackUrls]
    .filter((url) => typeof url === "string")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("http"))
    .filter(allowRpcUrl);
  if (allUrls.length === 0) return null;
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
