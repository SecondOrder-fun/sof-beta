// src/hooks/useSOFTransactions.js
//
// SOF transaction history for one or more addresses. Used by the
// Portfolio "SOF Holdings" tab.
//
// This used to be an in-browser ERC-20 transfer indexer: it scanned every
// season's bonding curve, called eth_getLogs across a multi-thousand-block
// range, then post-processed Transfer/TokensPurchased/TokensSold/Claimed
// events into a typed feed. Every Portfolio open burned through Tenderly's
// rate limits before the table could render.
//
// Now: one HTTP call per address to /api/token/sof/transactions/:user. The
// backend pulls SOF transfers from Blockscout, classifies them by
// counterparty against the contracts bundle + season_contracts table, and
// returns a typed list (BONDING_CURVE_BUY/SELL, PRIZE_CLAIM, AIRDROP,
// TRANSFER_IN/OUT) in the same shape the UI already consumes.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/hooks/chain/internal";

async function fetchForAddress(address) {
  const url = `${API_BASE}/token/sof/transactions/${address}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`SOF transactions ${res.status}`);
  }
  const json = await res.json();
  const rows = Array.isArray(json?.transactions) ? json.transactions : [];
  // Tag rows with the address they were fetched for so the UI can render
  // an EOA/SMA Origin badge when merging multiple addresses.
  return rows.map((row) => ({ ...row, origin: address.toLowerCase() }));
}

/**
 * @param {string | string[]} addressOrAddresses — single address or array
 *   (e.g. [EOA, SMA] for own profile). Cache key is sorted, so call-order
 *   doesn't fragment the cache.
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 */
export function useSOFTransactions(addressOrAddresses, options = {}) {
  const { enabled = true } = options;

  const addresses = useMemo(() => {
    const raw = Array.isArray(addressOrAddresses)
      ? addressOrAddresses
      : [addressOrAddresses];
    const normalized = raw.filter(Boolean).map((a) => a.toLowerCase());
    return Array.from(new Set(normalized)).sort();
  }, [addressOrAddresses]);

  return useQuery({
    queryKey: ["sofTransactions", "warm", addresses],
    enabled: enabled && addresses.length > 0,
    // Backend-served + Blockscout-cached; staleTime is generous since
    // transfer history is append-only and the UI doesn't need second-level
    // freshness. Post-tx invalidation (executeBatch / claim mutations)
    // covers the "I just bought tickets, refresh my history" case.
    staleTime: 60_000,
    queryFn: async () => {
      if (addresses.length === 0) return [];
      const perAddress = await Promise.all(addresses.map(fetchForAddress));
      const merged = perAddress.flat();

      // Dedupe by (hash, logIndex). A transfer EOA→SMA appears in both
      // /:eoa and /:sma queries; keep the first occurrence.
      const seen = new Set();
      const deduped = [];
      for (const row of merged) {
        const key = `${(row.hash || "").toLowerCase()}:${row.logIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
      }
      deduped.sort((a, b) => {
        const bn = Number(b.blockNumber) - Number(a.blockNumber);
        if (bn !== 0) return bn;
        return (Number(b.logIndex) || 0) - (Number(a.logIndex) || 0);
      });
      return deduped;
    },
  });
}
