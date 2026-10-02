// src/hooks/useSOFTransactions.js
//
// SOF transaction history for one address. Used by the
// Portfolio "SOF Holdings" tab.
//
// This used to be an in-browser ERC-20 transfer indexer: it scanned every
// season's bonding curve, called eth_getLogs across a multi-thousand-block
// range, then post-processed Transfer/TokensPurchased/TokensSold/Claimed
// events into a typed feed. Every Portfolio open burned through Tenderly's
// rate limits before the table could render.
//
// Now: one HTTP call to /api/token/sof/transactions/:user. The
// backend pulls SOF transfers from Blockscout, classifies them by
// counterparty against the contracts bundle + season_contracts table, and
// returns a typed list (BONDING_CURVE_BUY/SELL, PRIZE_CLAIM, AIRDROP,
// TRANSFER_IN/OUT) in the same shape the UI already consumes.

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/hooks/chain/internal";

/**
 * @param {string | undefined} address
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 */
export function useSOFTransactions(address, options = {}) {
  const { enabled = true } = options;
  // Lower-cased so checksum casing doesn't fragment the cache.
  const user = address ? address.toLowerCase() : null;

  return useQuery({
    queryKey: ["sofTransactions", "warm", user],
    enabled: enabled && !!user,
    // Backend-served + Blockscout-cached; staleTime is generous since
    // transfer history is append-only and the UI doesn't need second-level
    // freshness. Post-tx invalidation (executeBatch / claim mutations)
    // covers the "I just bought tickets, refresh my history" case.
    staleTime: 60_000,
    queryFn: async () => {
      const url = `${API_BASE}/token/sof/transactions/${user}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`SOF transactions ${res.status}`);
      }
      const json = await res.json();
      const rows = Array.isArray(json?.transactions) ? json.transactions : [];
      return [...rows].sort((a, b) => {
        const bn = Number(b.blockNumber) - Number(a.blockNumber);
        if (bn !== 0) return bn;
        return (Number(b.logIndex) || 0) - (Number(a.logIndex) || 0);
      });
    },
  });
}
