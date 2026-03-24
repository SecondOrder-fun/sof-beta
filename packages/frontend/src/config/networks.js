// src/config/networks.js
// Centralized chain configuration for frontend (Wagmi/Viem)
// Uses env-driven RPC URLs; defaults tuned for Local/Anvil

/**
 * @typedef {Object} ChainConfig
 * @property {number} id - EVM chain id
 * @property {string} name - Human-readable name
 * @property {string} rpcUrl - HTTPS RPC endpoint
 * @property {string} wsUrl - WebSocket RPC endpoint (optional)
 * @property {string} explorer - Block explorer base URL
 * @property {number} avgBlockTime - Average block time in seconds
 * @property {bigint} lookbackBlocks - Default lookback for historical queries
 */

/** @type {Record<string, ChainConfig>} */
export const NETWORKS = {
  LOCAL: {
    id: 31337,
    name: "Local Anvil",
    rpcUrl: import.meta.env.VITE_RPC_URL_LOCAL || "http://127.0.0.1:8545",
    wsUrl: import.meta.env.VITE_WS_URL_LOCAL || "",
    explorer: "",
    avgBlockTime: 1, // Anvil produces blocks instantly
    lookbackBlocks: 10000n, // Smaller lookback for local testing
  },
  TESTNET: {
    // Adjust to your target testnet (e.g., Base Sepolia 84532, Ethereum Sepolia 11155111)
    id: Number(import.meta.env.VITE_TESTNET_CHAIN_ID || 84532),
    name: import.meta.env.VITE_TESTNET_NAME || "Base Sepolia",
    rpcUrl: import.meta.env.VITE_RPC_URL_TESTNET || "",
    // Fallback RPCs disabled - most public RPCs don't support eth_newFilter
    // which causes 400 errors when viem tries filter-based polling
    rpcFallbackUrls: [],
    wsUrl: import.meta.env.VITE_WS_URL_TESTNET || "",
    explorer:
      import.meta.env.VITE_TESTNET_EXPLORER || "https://sepolia.basescan.org",
    avgBlockTime: 2, // Base has ~2 second block time
    lookbackBlocks: 100000n, // Larger lookback for testnet
  },
  MAINNET: {
    id: Number(import.meta.env.VITE_MAINNET_CHAIN_ID || 8453),
    name: import.meta.env.VITE_MAINNET_NAME || "Base",
    rpcUrl: import.meta.env.VITE_RPC_URL_MAINNET || "",
    wsUrl: import.meta.env.VITE_WS_URL_MAINNET || "",
    explorer: import.meta.env.VITE_MAINNET_EXPLORER || "https://basescan.org",
    avgBlockTime: 2, // Base has ~2 second block time
    lookbackBlocks: 100000n, // Larger lookback for mainnet
  },
};

/**
 * Returns the initial/default network key.
 * Default to LOCAL per project rules; can be overridden via env.
 */
export function getDefaultNetworkKey() {
  return (import.meta.env.VITE_DEFAULT_NETWORK || "LOCAL").toUpperCase();
}

/**
 * Safe getter for a chain by key, falling back to DEFAULT_NETWORK from .env.
 * @param {string} key
 * @returns {ChainConfig}
 */
export function getNetworkByKey(key) {
  // Respect DEFAULT_NETWORK from .env instead of hardcoding LOCAL
  const defaultNet = (
    import.meta.env.VITE_DEFAULT_NETWORK || "LOCAL"
  ).toUpperCase();
  const k = (key || defaultNet).toUpperCase();
  return NETWORKS[k] || NETWORKS[defaultNet] || NETWORKS.LOCAL;
}
