// src/lib/wagmi.js
// Wagmi configuration helper that builds a config per selected network.
// We intentionally keep this minimal and env-driven. The app can re-create
// the config when the network toggle changes.

import { fallback, http } from "viem";
import { getDefaultNetworkKey, getNetworkByKey } from "@/config/networks";

// Note: We avoid importing wagmi until provider wiring to prevent version
// coupling. If wagmi is already set up elsewhere, you can import createConfig
// and pass the chain object from here.

/**
 * Build a viem transport and chain descriptor for Wagmi.
 * @param {string} [networkKey]
 */
export function getChainConfig(networkKey) {
  const key = (networkKey || getDefaultNetworkKey()).toUpperCase();
  const cfg = getNetworkByKey(key);

  const rpcUrls = [cfg.rpcUrl, ...(cfg.rpcFallbackUrls || [])].filter(Boolean);
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
      import.meta.env.VITE_DEFAULT_NETWORK || "LOCAL"
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
