// backend/src/config/chain.js
// Chain configuration for backend services (read-only onchain)
// Addresses come from @sof/contracts deployment JSONs; RPC URLs remain env-driven.

import { getDeployment } from '@sof/contracts/deployments';

/**
 * Load chain env with sane defaults. Validates based on NETWORK.
 * Only validates RPC URL for the network that's actually being used.
 */
export function loadChainEnv() {
  const localAddrs = getDeployment('local');
  const testnetAddrs = getDeployment('testnet');
  const mainnetAddrs = getDeployment('mainnet');

  const env = {
    LOCAL: {
      id: Number(process.env.CHAIN_ID || 31337),
      name: process.env.CHAIN_NAME || "Local Anvil",
      rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
      raffle: localAddrs.Raffle || "",
      sof: localAddrs.SOFToken || "",
      infofiFactory: localAddrs.InfoFiFactory || "",
      infofiOracle: localAddrs.InfoFiPriceOracle || "",
      sofSmartAccount: localAddrs.SOFSmartAccount || "",
      rolloverEscrow: localAddrs.RolloverEscrow || "",
      avgBlockTime: 1,
      lookbackBlocks: 10000n,
    },
    TESTNET: {
      id: Number(process.env.CHAIN_ID || 84532),
      name: process.env.CHAIN_NAME || "Base Sepolia",
      rpcUrl: process.env.RPC_URL || "",
      raffle: testnetAddrs.Raffle || "",
      sof: testnetAddrs.SOFToken || "",
      curve: testnetAddrs.SOFBondingCurve || "",
      infofiFactory: testnetAddrs.InfoFiFactory || "",
      infofiOracle: testnetAddrs.InfoFiPriceOracle || "",
      sofSmartAccount: testnetAddrs.SOFSmartAccount || "",
      rolloverEscrow: testnetAddrs.RolloverEscrow || "",
      avgBlockTime: 2,
      lookbackBlocks: 50000n,
    },
    MAINNET: {
      id: Number(process.env.CHAIN_ID || 8453),
      name: process.env.CHAIN_NAME || "Base",
      rpcUrl: process.env.RPC_URL || "",
      raffle: mainnetAddrs.Raffle || "",
      sof: mainnetAddrs.SOFToken || "",
      curve: mainnetAddrs.SOFBondingCurve || "",
      infofiFactory: mainnetAddrs.InfoFiFactory || "",
      infofiOracle: mainnetAddrs.InfoFiPriceOracle || "",
      sofSmartAccount: mainnetAddrs.SOFSmartAccount || "",
      rolloverEscrow: mainnetAddrs.RolloverEscrow || "",
      avgBlockTime: 2,
      lookbackBlocks: 50000n,
    },
  };

  const defaultNet = (
    process.env.NETWORK || "LOCAL"
  ).toUpperCase();

  // Validate critical contract addresses are present for non-local networks
  if (defaultNet !== "LOCAL") {
    const critical = ['raffle', 'sof', 'infofiFactory', 'infofiOracle'];
    for (const key of critical) {
      if (!env[defaultNet]?.[key]) {
        // eslint-disable-next-line no-console
        console.warn(`[chain] Missing ${key} address for ${defaultNet}`);
      }
    }
  }

  if (defaultNet !== "LOCAL" && !env[defaultNet]?.rpcUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      `[chain] Missing RPC_URL env var for ${defaultNet}`,
    );
  }

  return env;
}

/**
 * Get a chain config by key (LOCAL/TESTNET/MAINNET) - NO FALLBACKS.
 * Validates RPC URL when accessed.
 * @param {string} key
 */
export function getChainByKey(key) {
  const env = loadChainEnv();

  const defaultNet = process.env.NETWORK;

  if (!defaultNet && !key) {
    throw new Error(
      "NETWORK environment variable not set and no network key provided. " +
        "Set NETWORK in your .env file or Railway environment variables.",
    );
  }

  const k = (key || defaultNet).toUpperCase();
  const chain = env[k];

  if (!chain) {
    throw new Error(
      `Invalid network: ${k}. Must be LOCAL, TESTNET, or MAINNET.`,
    );
  }

  if (!chain.rpcUrl && k !== "LOCAL") {
    throw new Error(
      `Missing RPC_URL environment variable for ${k}. ` +
        `Set this in your env/.env.{network} file or Railway environment variables.`,
    );
  }

  return chain;
}
