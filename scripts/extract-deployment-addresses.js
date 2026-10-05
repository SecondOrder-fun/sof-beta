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
//   node scripts/extract-deployment-addresses.js --network <testnet|mainnet|local> [--script <Name>.s.sol]
//
// Run after `forge script ... --broadcast` (or after a --resume completion).
//
// --script reads another script's broadcast (default DeployAll.s.sol). A partial
// deploy such as script/ops/RedeployLaunchpad.s.sol creates only some contracts,
// so its addresses are OVERLAID on the deployments file already on disk instead
// of replacing it.

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
// InfoFiMarketFactory → InfoFiFactory) for
// historical reasons in the deployments json shape that the frontend
// and backend both consume.
const CONTRACT_NAME_MAP = {
  // 01_DeployQuoteToken's placeholder (local / Base Sepolia only). Where a real token is
  // configured instead, QUOTE_TOKEN_ADDRESS supplies it below.
  MockERC20: "QuoteToken",
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
  RolloverEscrow: "RolloverEscrow",
  // Launchpad. PoolManager only appears as a CREATE on local — elsewhere it is the
  // pre-existing v4 singleton and comes through STATIC / POOL_MANAGER_ADDRESS.
  PoolManager: "PoolManager",
  TokenLaunchpad: "TokenLaunchpad",
  UniV4LiquidityPlacer: "LiquidityPlacer",
  LaunchPoolGate: "LaunchPoolGate",
  UniV4LaunchRouter: "LaunchRouter",
};

// Static / non-DeployAll addresses to merge into the output. These are
// either deployed per-season (so DeployAll never produces them) or are
// pre-existing third-party contracts on the target chain.
const STATIC = {
  testnet: {
    // Circle's USDC on Base Sepolia — allowlisted as a launch quote token.
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
  "QuoteToken",
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
  "RaffleOracleAdapter",
  "SeasonGating",
  "USDC",
  "RolloverEscrow",
  "PoolManager",
  "TokenLaunchpad",
  "LiquidityPlacer",
  "LaunchPoolGate",
  "LaunchRouter",
];

// Contracts whose deploy block the backend needs, recorded under `deployBlocks`.
// TokenLaunchpad: launchTradeListener reads the launchpad's whole RouterUpdated
// history from it, so a router retired long ago is still recognised (and its
// swaps attributed to the trader, not stored with the router as the trader).
const DEPLOY_BLOCK_KEYS = ["TokenLaunchpad"];

/**
 * Block numbers of the contracts in DEPLOY_BLOCK_KEYS, from the broadcast's receipts.
 * @param {object} bcast       run-latest.json
 * @param {object} contracts   key -> address, as extracted
 * @returns {Record<string, number>}
 */
export function deployBlocksFrom(bcast, contracts) {
  const blockByAddress = new Map();
  for (const r of bcast.receipts || []) {
    if (r.contractAddress && r.blockNumber != null) {
      blockByAddress.set(r.contractAddress.toLowerCase(), Number(BigInt(r.blockNumber)));
    }
  }
  const out = {};
  for (const key of DEPLOY_BLOCK_KEYS) {
    const addr = contracts[key];
    const block = addr ? blockByAddress.get(addr.toLowerCase()) : undefined;
    if (block !== undefined) out[key] = block;
  }
  return out;
}

/** The script whose broadcast is the whole deployment; any other is a partial overlay. */
const FULL_DEPLOY_SCRIPT = "DeployAll.s.sol";

function outPathFor(repoRoot, network) {
  return path.join(repoRoot, `packages/contracts/deployments/${network}.json`);
}

/** The deployment file already on disk, or `{}` if it is absent or unreadable. */
function readExisting(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

/** The `contracts` map already on disk, or `{}` if the file is absent or unreadable. */
function readExistingContracts(filePath) {
  return readExisting(filePath).contracts || {};
}

function parseArgs(argv) {
  const args = { network: null, script: FULL_DEPLOY_SCRIPT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--network") {
      args.network = argv[i + 1];
      i++;
    } else if (argv[i] === "--script") {
      args.script = argv[i + 1];
      i++;
    }
  }
  return args;
}

function main() {
  const { network, script } = parseArgs(process.argv.slice(2));
  if (!network || !NETWORKS[network] || !/^[A-Za-z0-9_]+\.s\.sol$/.test(script || "")) {
    console.error(
      `Usage: node scripts/extract-deployment-addresses.js --network <${Object.keys(NETWORKS).join("|")}> [--script <Name>.s.sol]`,
    );
    process.exit(1);
  }

  const cfg = NETWORKS[network];
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const broadcastPath = path.join(
    repoRoot,
    "packages/contracts/broadcast",
    script,
    String(cfg.chainId),
    "run-latest.json",
  );

  if (!fs.existsSync(broadcastPath)) {
    console.error(`Broadcast log not found: ${broadcastPath}`);
    console.error(`(Run 'forge script ... --broadcast' first.)`);
    process.exit(1);
  }

  const bcast = JSON.parse(fs.readFileSync(broadcastPath, "utf8"));

  // A partial deploy starts from the recorded addresses; DeployAll replaces them all.
  const partial = script !== FULL_DEPLOY_SCRIPT;
  const contracts = partial ? { ...readExistingContracts(outPathFor(repoRoot, network)) } : {};
  if (partial && Object.keys(contracts).length === 0) {
    console.error(`No deployments file to overlay ${script} onto — run a full deploy first.`);
    process.exit(1);
  }

  // Pull every CREATE / CREATE2 with a known contract name
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

  // Carry forward the Uniswap v4 PoolManager on non-local chains. It is a pre-existing
  // third-party singleton, so it never appears as a CREATE in our broadcast log and cannot
  // go in STATIC either — we do not want a per-chain address hardcoded in two places, and
  // the launchpad is meant to move chains. Without this step, re-running the extractor
  // would silently drop a PoolManager an operator had recorded, and the next deploy would
  // find nothing to resolve. POOL_MANAGER_ADDRESS wins when set, since that is what the
  // deploy that produced this broadcast actually used.
  if (network !== "local") {
    const fromEnv = process.env.POOL_MANAGER_ADDRESS;
    const existing = readExistingContracts(outPathFor(repoRoot, network)).PoolManager;
    const poolManager = fromEnv || existing;
    if (poolManager) contracts.PoolManager = poolManager;
    else console.warn("  WARN: no PoolManager for this network (launchpad launches will revert PlacerNotSet)");
  }

  // A configured quote token (QUOTE_TOKEN_ADDRESS, required off local/Base Sepolia) is not
  // a CREATE in the broadcast, so it comes from the same env the deploy read.
  if (process.env.QUOTE_TOKEN_ADDRESS) contracts.QuoteToken = process.env.QUOTE_TOKEN_ADDRESS.trim();
  if (!contracts.QuoteToken) console.warn("  WARN: no QuoteToken (set QUOTE_TOKEN_ADDRESS)");

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

  // Deploy blocks: from this broadcast's receipts; a contract this broadcast did not
  // deploy keeps the block already recorded, as long as its address is unchanged.
  const existing = readExisting(outPathFor(repoRoot, network));
  const deployBlocks = {};
  for (const key of DEPLOY_BLOCK_KEYS) {
    const prev = existing.deployBlocks?.[key];
    const sameAddress = existing.contracts?.[key]?.toLowerCase() === ordered[key]?.toLowerCase();
    if (prev !== undefined && sameAddress) deployBlocks[key] = prev;
  }
  Object.assign(deployBlocks, deployBlocksFrom(bcast, ordered));
  for (const key of DEPLOY_BLOCK_KEYS) {
    if (ordered[key] && deployBlocks[key] === undefined) {
      console.warn(`  WARN: no deploy block for ${key} (set LAUNCHPAD_DEPLOY_BLOCK on the backend)`);
    }
  }

  const json = {
    network: cfg.label,
    chainId: cfg.chainId,
    deployedAt: new Date().toISOString(),
    contracts: ordered,
    ...(Object.keys(deployBlocks).length ? { deployBlocks } : {}),
  };

  const outPath = outPathFor(repoRoot, network);
  fs.writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);

  console.log(
    `[extract-addresses] ${createCount} CREATE txs in broadcast → ${mappedCount} mapped → ` +
      `${Object.keys(ordered).length} written to ${path.relative(repoRoot, outPath)}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
