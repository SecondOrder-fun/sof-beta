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
// wagmi/viem falls back to them. Tenderly is canonical per CLAUDE.md, but we
// can't crash the app if the env was misconfigured — fall back to the raw
// list with a warning so the bundle still bootstraps.
const PROBLEMATIC_RPC_HOSTS = ["sepolia.base.org"];

function isProblematicRpcUrl(url) {
  if (!url) return false;
  return PROBLEMATIC_RPC_HOSTS.some((host) => url.includes(host));
}

/**
 * Build a viem transport and chain descriptor for Wagmi.
 * @param {string} [networkKey]
 */
export function getChainConfig(networkKey) {
  const key = (networkKey || getDefaultNetworkKey()).toUpperCase();
  const cfg = getNetworkByKey(key);

  const rawRpcUrls = [cfg.rpcUrl, ...(cfg.rpcFallbackUrls || [])].filter(Boolean);
  if (rawRpcUrls.length === 0) {
    throw new Error(`No RPC URL configured for network ${key}`);
  }
  const filteredRpcUrls = rawRpcUrls.filter((url) => !isProblematicRpcUrl(url));
  let rpcUrls;
  if (filteredRpcUrls.length > 0) {
    rpcUrls = filteredRpcUrls;
  } else {
    // All configured URLs are on the problematic list. Crashing here would
    // brick app boot — instead use the raw list and surface the
    // misconfiguration so it gets noticed and fixed in the deploy env.
    // eslint-disable-next-line no-console
    console.warn(
      `[getChainConfig] All configured RPC URLs for ${key} are on the problematic-host list (${PROBLEMATIC_RPC_HOSTS.join(", ")}). ` +
        `Update VITE_RPC_URL to a CORS-friendly endpoint (e.g. Tenderly). ` +
        `Falling back to the raw URL — expect CORS errors.`,
    );
    rpcUrls = rawRpcUrls;
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

  // batch: true tells viem to coalesce RPC calls issued in the same microtask
  // into a single HTTP POST — without this, every readContract / multicall /
  // useReadContract becomes its own request and burns through Tenderly free
  // tier rate limits within seconds of mounting a busy page.
  //
  // retryCount/retryDelay tame viem's default retry behavior, which turns a
  // single 429 into four rapid-fire bursts (default retryCount=3 with
  // exponential backoff, all of which 429 again under sustained load).
  const httpTransports = rpcUrls.map((url) =>
    http(url, {
      batch: true,
      retryCount: 1,
      retryDelay: 1500,
    }),
  );

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
