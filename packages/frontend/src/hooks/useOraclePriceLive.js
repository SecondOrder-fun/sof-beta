// src/hooks/useOraclePriceLive.js
// Read InfoFi oracle price on-chain and subscribe to PriceUpdated events (no backend)
import { useEffect, useMemo, useState } from "react";
import {
  readOraclePrice,
  subscribeOraclePriceUpdated,
} from "@/services/onchainInfoFi";
import { useQueryClient } from "@tanstack/react-query";

/**
 * useOraclePriceLive
 * @param {string} marketId bytes32 id (0x...)
 * @param {string} networkKey 'LOCAL' | 'TESTNET'
 */
export function useOraclePriceLive(marketId, networkKey = "TESTNET") {
  const id = useMemo(() => (marketId ? String(marketId) : null), [marketId]);
  const queryClient = useQueryClient();
  const [state, setState] = useState({
    hybridPriceBps: null,
    raffleProbabilityBps: null,
    marketSentimentBps: null,
    lastUpdated: null,
    active: false,
  });
  const [live, setLive] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Listen to position snapshot changes to trigger price refresh
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      // When position snapshots update, trigger a price refresh
      if (event?.query?.queryKey?.[0] === "playerSnapshot") {
        setRefreshTrigger((prev) => prev + 1);
      }
    });
    return () => unsubscribe();
  }, [queryClient]);

  // Initial fetch and on-change refetch
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      try {
        const p = await readOraclePrice({ marketId: id, networkKey });
        if (cancelled) return;
        setState({
          hybridPriceBps: p.hybridPriceBps,
          raffleProbabilityBps: p.raffleProbabilityBps,
          marketSentimentBps: p.marketSentimentBps,
          lastUpdated: Number(p.lastUpdate || 0) * 1000,
          active: Boolean(p.active),
        });
      } catch (_) {
        if (!cancelled) {
          setState((s) => ({ ...s, active: false }));
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, networkKey, refreshTrigger]);

  // Subscribe to on-chain PriceUpdated via WS when available
  useEffect(() => {
    if (!id) return () => {};
    const unsub = subscribeOraclePriceUpdated({
      networkKey,
      onEvent: (log) => {
        try {
          const {
            marketId: evId,
            raffleBps,
            marketBps,
            hybridBps,
            timestamp,
          } = log?.args || {};
          if (!evId) return;
          // Only update if this event matches our market id
          if (String(evId).toLowerCase() !== String(id).toLowerCase()) return;
          setState({
            hybridPriceBps: Number(hybridBps),
            raffleProbabilityBps: Number(raffleBps),
            marketSentimentBps: Number(marketBps),
            lastUpdated: Number(timestamp || Date.now()),
            active: true,
          });
          setLive(true);
        } catch (_) {
          /* ignore malformed log */
        }
      },
    });
    return () => {
      setLive(false);
      unsub?.();
    };
  }, [id, networkKey]);

  // Polling fallback (refresh every 5s) — useful if WS is unavailable or roles aren't wired yet
  useEffect(() => {
    if (!id) return () => {};
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const p = await readOraclePrice({ marketId: id, networkKey });
        if (cancelled) return;
        // Only update if values actually changed to avoid flicker
        const changed =
          Number(p.hybridPriceBps) !== Number(state.hybridPriceBps) ||
          Number(p.raffleProbabilityBps) !==
            Number(state.raffleProbabilityBps) ||
          Number(p.marketSentimentBps) !== Number(state.marketSentimentBps);
        if (changed) {
          setState({
            hybridPriceBps: p.hybridPriceBps,
            raffleProbabilityBps: p.raffleProbabilityBps,
            marketSentimentBps: p.marketSentimentBps,
            lastUpdated: Number(p.lastUpdate || Date.now()),
            active: Boolean(p.active),
          });
        }
      } catch (_) {
        /* ignore polling errors */
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    id,
    networkKey,
    state.hybridPriceBps,
    state.raffleProbabilityBps,
    state.marketSentimentBps,
  ]);

  return { data: state, isLive: live };
}
