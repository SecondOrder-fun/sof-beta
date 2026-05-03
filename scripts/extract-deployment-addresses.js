#!/usr/bin/env node
/* eslint-disable no-console */

// extract-deployment-addresses.js — Source of truth: forge broadcast log.
//
// The Solidity DeployAll script writes deployments/<network>.json from its
// in-memory `addrs` struct. That struct gets corrupted when --resume is used
// to recover from a partial broadcast (the resume re-simulates the script,
// but the slot bookkeeping doesn't survive intact, and the produced JSON has
// addresses shifted by however many transactions failed in the first pass).
// Hit this on the 2026-05-02 testnet redeploy: every contract slot was
// pointing at a different contract's bytecode, so the frontend was calling
// random unrelated contracts and reverting.
//
// Forge's broadcast log (broadcast/DeployAll.s.sol/<chainId>/run-latest.json)
// is the authoritative record of which address got which contract — every
// CREATE/CREATE2 entry has the matched contractName + contractAddress. This
// script reads that log and rewrites deployments/<network>.json with the
// correct mapping.
//
// Usage:
//   node scripts/extract-deployment-addresses.js --network <testnet|mainnet|local>
//
// Run after `forge script ... --broadcast` (or after a --resume completion).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NETWORKS = {
  local: { chainId: 31337, label: "anvil" },
  testnet: { chainId: 84532, label: "base-sepolia" },
  mainnet: { chainId: 8453, label: "base" },
};

// forge contractName → key in deployments/<network>.json. The names
// diverge in places (ConditionalTokenSOF → ConditionalTokens,
// InfoFiFPMMV2 → InfoFiFPMM, RafflePrizeDistributor → PrizeDistributor,
// SOFPaymaster → Paymaster, InfoFiMarketFactory → InfoFiFactory) for
// historical reasons in the deployments json shape that the frontend
// and backend both consume.
const CONTRACT_NAME_MAP = {
  SOFToken: "SOFToken",
  Raffle: "Raffle",
  SeasonFactory: "SeasonFactory",
  InfoFiPriceOracle: "InfoFiPriceOracle",
  ConditionalTokenSOF: "ConditionalTokens",
  RaffleOracleAdapter: "RaffleOracleAdapter",
  InfoFiFPMMV2: "InfoFiFPMM",
  MarketTypeRegistry: "MarketTypeRegistry",
  InfoFiMarketFactory: "InfoFiFactory",
  InfoFiSettlement: "InfoFiSettlement",
  RafflePrizeDistributor: "PrizeDistributor",
  SOFFaucet: "SOFFaucet",
  SOFSmartAccount: "SOFSmartAccount",
  SOFPaymaster: "Paymaster",
  RolloverEscrow: "RolloverEscrow",
  SOFExchange: "SOFExchange",
  SOFAirdrop: "SOFAirdrop",
};

// Static / non-DeployAll addresses to merge into the output. These are
// either deployed per-season (so DeployAll never produces them) or are
// pre-existing third-party contracts on the target chain.
const STATIC = {
  testnet: {
    USDC: "0x0000000000000000000000000000000000000000",
    // Chainlink VRF v2.5 coordinator on Base Sepolia (constant)
    VRFCoordinator: "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE",
    // Per-season — populated when SeasonFactory creates the first season
    SOFBondingCurve: "0x0000000000000000000000000000000000000000",
    SeasonGating: "0x0000000000000000000000000000000000000000",
  },
  mainnet: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    // Chainlink VRF v2.5 coordinator on Base mainnet
    VRFCoordinator: "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634",
    SOFBondingCurve: "0x0000000000000000000000000000000000000000",
    SeasonGating: "0x0000000000000000000000000000000000000000",
  },
  local: {
    USDC: "0x0000000000000000000000000000000000000000",
    VRFCoordinator: "0x0000000000000000000000000000000000000000",
    SOFBondingCurve: "0x0000000000000000000000000000000000000000",
    SeasonGating: "0x0000000000000000000000000000000000000000",
  },
};

// Canonical key order for human-readable diff stability
const KEY_ORDER = [
  "SOFToken",
  "Raffle",
  "SeasonFactory",
  "SOFBondingCurve",
  "InfoFiFactory",
  "InfoFiPriceOracle",
  "InfoFiSettlement",
  "InfoFiFPMM",
  "ConditionalTokens",
  "MarketTypeRegistry",
  "VRFCoordinator",
  "PrizeDistributor",
  "SOFFaucet",
  "RaffleOracleAdapter",
  "SeasonGating",
  "SOFExchange",
  "SOFAirdrop",
  "USDC",
  "SOFSmartAccount",
  "Paymaster",
  "RolloverEscrow",
];

function parseArgs(argv) {
  const args = { network: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--network") {
      args.network = argv[i + 1];
      i++;
    }
  }
  return args;
}

function main() {
  const { network } = parseArgs(process.argv.slice(2));
  if (!network || !NETWORKS[network]) {
    console.error(
      `Usage: node scripts/extract-deployment-addresses.js --network <${Object.keys(NETWORKS).join("|")}>`,
    );
    process.exit(1);
  }

  const cfg = NETWORKS[network];
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const broadcastPath = path.join(
    repoRoot,
    "packages/contracts/broadcast/DeployAll.s.sol",
    String(cfg.chainId),
    "run-latest.json",
  );

  if (!fs.existsSync(broadcastPath)) {
    console.error(`Broadcast log not found: ${broadcastPath}`);
    console.error(`(Run 'forge script ... --broadcast' first.)`);
    process.exit(1);
  }

  const bcast = JSON.parse(fs.readFileSync(broadcastPath, "utf8"));

  // Pull every CREATE / CREATE2 with a known contract name
  const contracts = {};
  let createCount = 0;
  let mappedCount = 0;
  for (const tx of bcast.transactions || []) {
    if (tx.transactionType !== "CREATE" && tx.transactionType !== "CREATE2") continue;
    createCount++;
    const key = CONTRACT_NAME_MAP[tx.contractName];
    if (!key || !tx.contractAddress) continue;
    // Last-wins: if the same contract was deployed multiple times in this
    // broadcast, the latest address is the live one.
    contracts[key] = tx.contractAddress;
    mappedCount++;
  }

  // Merge static + per-network
  Object.assign(contracts, STATIC[network] || {});

  // Reorder for human-readable stability; warn on unmapped keys
  const ordered = {};
  for (const key of KEY_ORDER) {
    if (key in contracts) ordered[key] = contracts[key];
  }
  const unordered = Object.keys(contracts).filter((k) => !(k in ordered));
  for (const k of unordered) {
    ordered[k] = contracts[k];
    console.warn(`  WARN: ${k} not in KEY_ORDER (consider adding for stable diffs)`);
  }

  const json = {
    network: cfg.label,
    chainId: cfg.chainId,
    deployedAt: new Date().toISOString(),
    contracts: ordered,
  };

  const outPath = path.join(repoRoot, `packages/contracts/deployments/${network}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);

  console.log(
    `[extract-addresses] ${createCount} CREATE txs in broadcast → ${mappedCount} mapped → ` +
      `${Object.keys(ordered).length} written to ${path.relative(repoRoot, outPath)}`,
  );
}

main();
