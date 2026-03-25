// src/config/networks.js
// Centralized chain configuration for frontend (Wagmi/Viem)
// Uses VITE_NETWORK to select the active network config.
// Env vars use canonical names without _LOCAL/_TESTNET/_MAINNET suffixes.

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
    rpcUrl: import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545",
    wsUrl: import.meta.env.VITE_WS_URL || "",
    explorer: "",
    avgBlockTime: 1,
    lookbackBlocks: 10000n,
  },
  TESTNET: {
    id: Number(import.meta.env.VITE_CHAIN_ID || 84532),
    name: import.meta.env.VITE_CHAIN_NAME || "Base Sepolia",
    rpcUrl: import.meta.env.VITE_RPC_URL || "",
    rpcFallbackUrls: [],
    wsUrl: import.meta.env.VITE_WS_URL || "",
    explorer: import.meta.env.VITE_EXPLORER || "https://sepolia.basescan.org",
    avgBlockTime: 2,
    lookbackBlocks: 100000n,
  },
  MAINNET: {
    id: Number(import.meta.env.VITE_CHAIN_ID || 8453),
    name: import.meta.env.VITE_CHAIN_NAME || "Base",
    rpcUrl: import.meta.env.VITE_RPC_URL || "",
    wsUrl: import.meta.env.VITE_WS_URL || "",
    explorer: import.meta.env.VITE_EXPLORER || "https://basescan.org",
    avgBlockTime: 2,
    lookbackBlocks: 100000n,
  },
};

/**
 * Returns the active network key based on VITE_NETWORK env var.
 */
export function getDefaultNetworkKey() {
  return (import.meta.env.VITE_NETWORK || "LOCAL").toUpperCase();
}

/**
 * Safe getter for a chain by key, falling back to VITE_NETWORK.
 * @param {string} key
 * @returns {ChainConfig}
 */
export function getNetworkByKey(key) {
  const defaultNet = (import.meta.env.VITE_NETWORK || "LOCAL").toUpperCase();
  const k = (key || defaultNet).toUpperCase();
  return NETWORKS[k] || NETWORKS[defaultNet] || NETWORKS.LOCAL;
}
