// src/config/contracts.js
// Contract addresses per network (frontend)
// Addresses come from @sof/contracts deployment JSONs.

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
 * @property {`0x${string}` | string} SOF_SMART_ACCOUNT
 * @property {`0x${string}` | string} ROLLOVER_ESCROW
 */

import { RaffleABI, SeasonGatingABI, SOFSmartAccountABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';

export const RAFFLE_ABI = RaffleABI;
export const SEASON_GATING_ABI = SeasonGatingABI;
export const SOF_SMART_ACCOUNT_ABI = SOFSmartAccountABI;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Sanitize an address: trim whitespace, strip trailing literal
 * "\n", and validate format. Returns "" for empty/missing, logs console.error
 * for non-empty values that fail validation so bad addresses are caught immediately.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeAddress(raw) {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/\\n$/g, "");
  if (!cleaned) return "";
  if (!ADDR_RE.test(cleaned)) {
    // eslint-disable-next-line no-console -- intentional: surface bad addresses loudly
    console.error(
      `[contracts] Invalid contract address: "${raw}" (cleaned: "${cleaned}").`
    );
    return "";
  }
  return cleaned;
}

/** Shorthand — sanitize an address with fallback to "" */
const s = (addr) => sanitizeAddress(addr || "");

/**
 * Returns addresses for selected network key.
 * @param {string} key
 * @returns {ContractAddresses}
 */
export function getContractAddresses(key) {
  const networkMap = { LOCAL: 'local', TESTNET: 'testnet', MAINNET: 'mainnet' };
  const k = (key || import.meta.env.VITE_NETWORK || 'local').toUpperCase();
  const network = networkMap[k] || 'local';
  const deployment = getDeployment(network);

  return {
    RAFFLE: s(deployment.Raffle),
    SOF: s(deployment.SOFToken),
    SEASON_FACTORY: s(deployment.SeasonFactory),
    SEASON_GATING: s(deployment.SeasonGating),
    INFOFI_FACTORY: s(deployment.InfoFiFactory),
    INFOFI_ORACLE: s(deployment.InfoFiPriceOracle),
    INFOFI_SETTLEMENT: s(deployment.InfoFiSettlement),
    INFOFI_FPMM: s(deployment.InfoFiFPMM),
    CONDITIONAL_TOKENS: s(deployment.ConditionalTokens),
    VRF_COORDINATOR: s(deployment.VRFCoordinator),
    PRIZE_DISTRIBUTOR: s(deployment.PrizeDistributor),
    SOF_FAUCET: s(deployment.SOFFaucet),
    SOF_EXCHANGE: s(deployment.SOFExchange),
    SOF_AIRDROP: s(deployment.SOFAirdrop),
    USDC: s(deployment.USDC),
    MARKET_TYPE_REGISTRY: s(deployment.MarketTypeRegistry),
    RAFFLE_ORACLE_ADAPTER: s(deployment.RaffleOracleAdapter),
    SOF_SMART_ACCOUNT: s(deployment.SOFSmartAccount),
    ROLLOVER_ESCROW: s(deployment.RolloverEscrow),
  };
}
