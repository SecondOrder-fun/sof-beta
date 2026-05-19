// backend/src/services/sofTransactionsService.js
//
// Builds the per-user SOF transaction feed served by /api/sof/transactions/:user.
//
// We hit Blockscout's /addresses/{user}/token-transfers endpoint (filtered
// to the SOF token), then classify each transfer by counterparty so the
// frontend can render a typed row (bonding-curve buy/sell, prize claim,
// transfer in/out, etc.) without running its own indexer or hitting the
// chain. Counterparty lookups use:
//
//   - season_contracts (DB)            — bonding-curve & raffle-token addresses → seasonId
//   - the contracts bundle             — fixed addresses (PrizeDistributor, Faucet, Airdrop, …)
//   - the Multicall3 address           — neutral relay; treat as transparent
//
// The shape returned matches what the existing SOFTransactionHistory
// component already consumes, so the frontend hook becomes a thin warm
// wrapper.

import { getDeployment } from "@sof/contracts/deployments";
import { sofMetadataCache } from "../lib/sofMetadataCache.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";

function lower(addr) {
  return typeof addr === "string" ? addr.toLowerCase() : addr;
}

// Drop a transfer row to the lower-cased counterparty address (the side
// that ISN'T `user`).
function counterparty(tx, userLower) {
  const from = lower(tx.from?.hash || tx.from);
  const to = lower(tx.to?.hash || tx.to);
  if (from === userLower) return { side: "OUT", other: to };
  if (to === userLower) return { side: "IN", other: from };
  return { side: null, other: null };
}

function classify(side, other, { bondingCurveMap, knownContracts }) {
  // Bonding curve → SOF transfer with the user is a ticket buy (user → curve)
  // or sell (curve → user). The seasonId is attached for the UI badge.
  const curveSeasonId = bondingCurveMap.get(other);
  if (curveSeasonId != null) {
    return side === "OUT"
      ? {
          type: "BONDING_CURVE_BUY",
          direction: "OUT",
          description: "Bought raffle tickets",
          seasonId: curveSeasonId,
        }
      : {
          type: "BONDING_CURVE_SELL",
          direction: "IN",
          description: "Sold raffle tickets",
          seasonId: curveSeasonId,
        };
  }

  if (other === knownContracts.prizeDistributor) {
    return side === "IN"
      ? {
          type: "PRIZE_CLAIM",
          direction: "IN",
          description: "Claimed raffle prize",
        }
      : {
          type: "TRANSFER_OUT",
          direction: "OUT",
          description: "Sent SOF",
        };
  }

  if (other === knownContracts.faucet) {
    return {
      type: "AIRDROP",
      direction: "IN",
      description: "Received from faucet",
    };
  }

  if (other === knownContracts.airdrop) {
    return {
      type: "AIRDROP",
      direction: "IN",
      description: "Airdrop claim",
    };
  }

  // Multicall is a transparent relay — surface as a plain transfer.
  if (other === MULTICALL3) {
    return side === "IN"
      ? { type: "TRANSFER_IN", direction: "IN", description: "Received SOF" }
      : { type: "TRANSFER_OUT", direction: "OUT", description: "Sent SOF" };
  }

  // ETH airdrop / mint surface as the zero address on the `from` side.
  if (other === ZERO) {
    return {
      type: "AIRDROP",
      direction: "IN",
      description: "Minted SOF",
    };
  }

  // Fall-through.
  return side === "IN"
    ? { type: "TRANSFER_IN", direction: "IN", description: "Received SOF" }
    : { type: "TRANSFER_OUT", direction: "OUT", description: "Sent SOF" };
}

function rowAmount(tx) {
  const raw = tx.total?.value ?? tx.value ?? "0";
  const decimals = Number(tx.total?.decimals ?? 18);
  // Blockscout returns base-units; the UI wants a human string (4-decimal
  // display happens in TransactionRow). formatUnits with the right
  // decimals.
  try {
    if (typeof raw !== "string" && typeof raw !== "number") return "0";
    const big = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = big / base;
    const frac = (big % base).toString().padStart(decimals, "0").slice(0, 6);
    return `${whole}.${frac}`;
  } catch {
    return "0";
  }
}

/**
 * Fetch & classify SOF transfers for one user.
 *
 * @param {object} deps
 * @param {object} deps.blockscoutClient   — createBlockscoutClient result
 * @param {object} deps.db                  — shared/supabaseClient db
 * @param {string} deps.network             — "TESTNET" | "LOCAL" | "MAINNET"
 * @param {string} user                    — user EOA or SMA
 */
export async function fetchSofTransactions({ blockscoutClient, db, network }, user) {
  if (!user || typeof user !== "string") {
    throw new Error("user address required");
  }
  const userLower = lower(user);
  const sofAddress = sofMetadataCache.address || getDeployment(network)?.SOFToken;
  if (!sofAddress) {
    throw new Error("SOF token address missing from deployment");
  }

  // Pull Blockscout's per-user SOF token transfers. type=ERC-20 keeps us
  // strictly on fungible transfers (not NFT mint/burn events).
  const raw = await blockscoutClient.fetch(
    "addresses/:address/token-transfers",
    {
      address: user,
      token: sofAddress,
      type: "ERC-20",
    },
  );

  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (items.length === 0) return [];

  // Build counterparty maps. season_contracts gives us every bonding
  // curve we've ever indexed; the deployment JSON gives us the fixed
  // addresses (PrizeDistributor, Faucet, Airdrop).
  const seasonRows = await db.getAllSeasonContracts();
  const bondingCurveMap = new Map();
  for (const row of seasonRows) {
    if (row.bonding_curve_address) {
      bondingCurveMap.set(lower(row.bonding_curve_address), row.season_id);
    }
  }

  const deployment = getDeployment(network) || {};
  const knownContracts = {
    prizeDistributor: lower(deployment.RafflePrizeDistributor),
    faucet: lower(deployment.SOFFaucet),
    airdrop: lower(deployment.SOFAirdrop),
  };

  const out = [];
  for (const tx of items) {
    const { side, other } = counterparty(tx, userLower);
    if (!side || !other) continue;
    const cls = classify(side, other, { bondingCurveMap, knownContracts });
    out.push({
      type: cls.type,
      direction: cls.direction,
      description: cls.description,
      seasonId: cls.seasonId,
      hash: tx.transaction_hash || tx.tx_hash,
      logIndex: tx.log_index ?? null,
      blockNumber: tx.block_number,
      timestamp: tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : null,
      from: tx.from?.hash || tx.from,
      to: tx.to?.hash || tx.to,
      amount: rowAmount(tx),
      // origin tag so own-profile views can render EOA/SMA badges.
      origin: userLower,
    });
  }

  // Newest first (Blockscout already returns newest-first, but be safe).
  out.sort((a, b) => {
    const bn = Number(b.blockNumber) - Number(a.blockNumber);
    if (bn !== 0) return bn;
    return (Number(b.logIndex) || 0) - (Number(a.logIndex) || 0);
  });

  return out;
}
