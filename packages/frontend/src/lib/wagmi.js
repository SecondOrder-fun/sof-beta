// src/lib/wagmi.js
// Wagmi configuration helper that builds a config per selected network.
// We intentionally keep this minimal and env-driven. The app can re-create
// the config when the network toggle changes.

import { fallback, http } from "viem";
import { getDefaultNetworkKey, getNetworkByKey } from "@/config/networks";

// Note: We avoid importing wagmi until provider wiring to prevent version
// coupling. If wagmi is already set up elsewhere, you can import createConfig
// and pass the chain object from here.

// Public RPC hosts that don't set CORS headers for browser origins. Including
// any of these in our wagmi transports leaks browser-visible CORS errors when
// wagmi/viem falls back to them (e.g. when the configured VITE_RPC_URL is
// rate-limited or transiently failing). Tenderly is canonical per CLAUDE.md.
const BLOCKED_RPC_HOSTS = ["sepolia.base.org"];

function allowRpcUrl(url) {
  if (!url) return false;
  for (const host of BLOCKED_RPC_HOSTS) {
    if (url.includes(host)) return false;
  }
  return true;
}

/**
 * Build a viem transport and chain descriptor for Wagmi.
 * @param {string} [networkKey]
 */
export function getChainConfig(networkKey) {
  const key = (networkKey || getDefaultNetworkKey()).toUpperCase();
  const cfg = getNetworkByKey(key);

  const rpcUrls = [cfg.rpcUrl, ...(cfg.rpcFallbackUrls || [])]
    .filter(Boolean)
    .filter(allowRpcUrl);
  if (rpcUrls.length === 0) {
    throw new Error(`No RPC URL configured for network ${key}`);
  }

  // Minimal chain object compatible with Wagmi custom chains
  const chain = {
    id: cfg.id,
    name: cfg.name,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: rpcUrls },
      public: { http: rpcUrls },
    },
  };

  const httpTransports = rpcUrls.map((url) => http(url));

  const transport =
    httpTransports.length > 1
      ? fallback(httpTransports, { rank: false })
      : httpTransports[0];

  return { key, chain, transport };
}

/**
 * Persist & retrieve network selection.
 */
const STORAGE_KEY = "sof:selectedNetworkKey";

export function getStoredNetworkKey() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return (v || getDefaultNetworkKey()).toUpperCase();
  } catch {
    return getDefaultNetworkKey();
  }
}

export function setStoredNetworkKey(key) {
  try {
    // Respect DEFAULT_NETWORK from .env instead of hardcoding LOCAL
    const defaultNet = (
      import.meta.env.VITE_NETWORK || "LOCAL"
    ).toUpperCase();
    localStorage.setItem(STORAGE_KEY, (key || defaultNet).toUpperCase());
    // Notify app to re-initialize providers if needed
    window.dispatchEvent(
      new CustomEvent("sof:network-changed", { detail: { key } }),
    );
  } catch (e) {
    // Reason: some environments (SSR/tests) may not have localStorage; safely ignore.
    return;
  }
}
