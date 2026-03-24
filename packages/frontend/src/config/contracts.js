// src/config/contracts.js
// Contract addresses per network (frontend)
// Values come from Vite env. Keep testnet empty until deployed.

/**
 * @typedef {Object} ContractAddresses
 * @property {`0x${string}` | string} RAFFLE
 * @property {`0x${string}` | string} SOF
 * @property {`0x${string}` | string} SEASON_FACTORY
 * @property {`0x${string}` | string} SEASON_GATING
 * @property {`0x${string}` | string} INFOFI_FACTORY
 * @property {`0x${string}` | string} INFOFI_ORACLE
 * @property {`0x${string}` | string} INFOFI_SETTLEMENT
 * @property {`0x${string}` | string} INFOFI_FPMM // FPMM manager contract
 * @property {`0x${string}` | string} CONDITIONAL_TOKENS // Gnosis Conditional Tokens
 * @property {`0x${string}` | string} VRF_COORDINATOR
 * @property {`0x${string}` | string} PRIZE_DISTRIBUTOR
 * @property {`0x${string}` | string} SOF_FAUCET
 * @property {`0x${string}` | string} SOF_EXCHANGE
 * @property {`0x${string}` | string} SOF_AIRDROP
 * @property {`0x${string}` | string} USDC
 */

import RAFFLE_ABI_JSON from "../contracts/abis/Raffle.json";
import SEASON_GATING_ABI_JSON from "../contracts/abis/SeasonGating.json";

// Extract the abi array from Foundry's JSON output format (handle both formats)
export const RAFFLE_ABI = RAFFLE_ABI_JSON.abi || RAFFLE_ABI_JSON;
export const SEASON_GATING_ABI = SEASON_GATING_ABI_JSON.abi || SEASON_GATING_ABI_JSON;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Sanitize an address from env vars: trim whitespace, strip trailing literal
 * "\n", and validate format. Returns "" for empty/missing, logs console.error
 * for non-empty values that fail validation so bad env vars are caught immediately.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeAddress(raw) {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/\\n$/g, "");
  if (!cleaned) return "";
  if (!ADDR_RE.test(cleaned)) {
    // eslint-disable-next-line no-console -- intentional: surface bad env vars loudly
    console.error(
      `[contracts] Invalid contract address in env var: "${raw}" (cleaned: "${cleaned}"). ` +
      "Check Vercel/Railway env vars for trailing characters or typos."
    );
    return "";
  }
  return cleaned;
}

/** Shorthand — sanitize an env var with fallback to "" */
const s = (envVal) => sanitizeAddress(envVal || "");

/** @type {Record<string, ContractAddresses>} */
export const CONTRACTS = {
  LOCAL: {
    RAFFLE: s(import.meta.env.VITE_RAFFLE_ADDRESS_LOCAL),
    SOF: s(import.meta.env.VITE_SOF_ADDRESS_LOCAL),
    SEASON_FACTORY: s(import.meta.env.VITE_SEASON_FACTORY_ADDRESS_LOCAL),
    SEASON_GATING: s(import.meta.env.VITE_SEASON_GATING_ADDRESS_LOCAL),
    INFOFI_FACTORY: s(import.meta.env.VITE_INFOFI_FACTORY_ADDRESS_LOCAL),
    INFOFI_ORACLE: s(import.meta.env.VITE_INFOFI_ORACLE_ADDRESS_LOCAL),
    INFOFI_SETTLEMENT: s(import.meta.env.VITE_INFOFI_SETTLEMENT_ADDRESS_LOCAL),
    INFOFI_MARKET: s(import.meta.env.VITE_INFOFI_MARKET_ADDRESS_LOCAL), // legacy
    INFOFI_FPMM: s(import.meta.env.VITE_INFOFI_FPMM_ADDRESS_LOCAL),
    CONDITIONAL_TOKENS: s(import.meta.env.VITE_CONDITIONAL_TOKENS_ADDRESS_LOCAL),
    VRF_COORDINATOR: s(import.meta.env.VITE_VRF_COORDINATOR_ADDRESS_LOCAL),
    PRIZE_DISTRIBUTOR: s(import.meta.env.VITE_PRIZE_DISTRIBUTOR_ADDRESS_LOCAL),
    SOF_FAUCET: s(import.meta.env.VITE_SOF_FAUCET_ADDRESS_LOCAL),
    SOF_EXCHANGE: s(import.meta.env.VITE_SOF_EXCHANGE_ADDRESS_LOCAL),
    SOF_AIRDROP: s(import.meta.env.VITE_SOF_AIRDROP_ADDRESS_LOCAL),
    USDC: s(import.meta.env.VITE_USDC_ADDRESS_LOCAL),
  },
  TESTNET: {
    RAFFLE: s(import.meta.env.VITE_RAFFLE_ADDRESS_TESTNET),
    SOF: s(import.meta.env.VITE_SOF_ADDRESS_TESTNET),
    SEASON_FACTORY: s(import.meta.env.VITE_SEASON_FACTORY_ADDRESS_TESTNET),
    SEASON_GATING: s(import.meta.env.VITE_SEASON_GATING_ADDRESS_TESTNET),
    INFOFI_FACTORY: s(import.meta.env.VITE_INFOFI_FACTORY_ADDRESS_TESTNET),
    INFOFI_ORACLE: s(import.meta.env.VITE_INFOFI_ORACLE_ADDRESS_TESTNET),
    INFOFI_SETTLEMENT: s(import.meta.env.VITE_INFOFI_SETTLEMENT_ADDRESS_TESTNET),
    INFOFI_MARKET: s(import.meta.env.VITE_INFOFI_MARKET_ADDRESS_TESTNET), // legacy
    INFOFI_FPMM: s(import.meta.env.VITE_INFOFI_FPMM_ADDRESS_TESTNET),
    CONDITIONAL_TOKENS: s(import.meta.env.VITE_CONDITIONAL_TOKENS_ADDRESS_TESTNET),
    VRF_COORDINATOR: s(import.meta.env.VITE_VRF_COORDINATOR_ADDRESS_TESTNET),
    PRIZE_DISTRIBUTOR: s(import.meta.env.VITE_PRIZE_DISTRIBUTOR_ADDRESS_TESTNET),
    SOF_FAUCET: s(import.meta.env.VITE_SOF_FAUCET_ADDRESS_TESTNET),
    SOF_EXCHANGE: s(import.meta.env.VITE_SOF_EXCHANGE_ADDRESS_TESTNET),
    SOF_AIRDROP: s(import.meta.env.VITE_SOF_AIRDROP_ADDRESS_TESTNET),
    USDC: s(import.meta.env.VITE_USDC_ADDRESS_TESTNET),
  },
  MAINNET: {
    RAFFLE: s(import.meta.env.VITE_RAFFLE_ADDRESS_MAINNET),
    SOF: s(import.meta.env.VITE_SOF_ADDRESS_MAINNET),
    SEASON_FACTORY: s(import.meta.env.VITE_SEASON_FACTORY_ADDRESS_MAINNET),
    SEASON_GATING: s(import.meta.env.VITE_SEASON_GATING_ADDRESS_MAINNET),
    INFOFI_FACTORY: s(import.meta.env.VITE_INFOFI_FACTORY_ADDRESS_MAINNET),
    INFOFI_ORACLE: s(import.meta.env.VITE_INFOFI_ORACLE_ADDRESS_MAINNET),
    INFOFI_SETTLEMENT: s(import.meta.env.VITE_INFOFI_SETTLEMENT_ADDRESS_MAINNET),
    INFOFI_MARKET: s(import.meta.env.VITE_INFOFI_MARKET_ADDRESS_MAINNET), // legacy
    INFOFI_FPMM: s(import.meta.env.VITE_INFOFI_FPMM_ADDRESS_MAINNET),
    CONDITIONAL_TOKENS: s(import.meta.env.VITE_CONDITIONAL_TOKENS_ADDRESS_MAINNET),
    VRF_COORDINATOR: s(import.meta.env.VITE_VRF_COORDINATOR_ADDRESS_MAINNET),
    PRIZE_DISTRIBUTOR: s(import.meta.env.VITE_PRIZE_DISTRIBUTOR_ADDRESS_MAINNET),
    SOF_FAUCET: s(import.meta.env.VITE_SOF_FAUCET_ADDRESS_MAINNET),
    SOF_EXCHANGE: s(import.meta.env.VITE_SOF_EXCHANGE_ADDRESS_MAINNET),
    SOF_AIRDROP: s(import.meta.env.VITE_SOF_AIRDROP_ADDRESS_MAINNET),
    USDC: s(import.meta.env.VITE_USDC_ADDRESS_MAINNET),
  },
};

/**
 * Returns addresses for selected network key.
 * @param {string} key
 * @returns {ContractAddresses}
 */
export function getContractAddresses(key) {
  const k = (key || "LOCAL").toUpperCase();
  return CONTRACTS[k] || CONTRACTS.LOCAL;
}
