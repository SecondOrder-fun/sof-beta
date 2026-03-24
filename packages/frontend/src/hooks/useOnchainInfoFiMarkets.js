// src/hooks/useOnchainInfoFiMarkets.js
// Fetch InfoFi markets directly from chain (no backend DB)
import { useEffect, useMemo, useState } from "react";
import {
  listSeasonWinnerMarkets,
  subscribeMarketCreated,
} from "@/services/onchainInfoFi";

/**
 * useOnchainInfoFiMarkets
 * @param {number|string} seasonId
 * @param {string} networkKey 'LOCAL' | 'TESTNET'
 */
export function useOnchainInfoFiMarkets(seasonId, networkKey = "TESTNET") {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sid = useMemo(
    () => (seasonId == null ? null : Number(seasonId)),
    [seasonId]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (sid == null || Number.isNaN(sid)) {
        setMarkets([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await listSeasonWinnerMarkets({
          seasonId: sid,
          networkKey,
        });
        if (!cancelled) setMarkets(data);
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // Live updates via MarketCreated events
    const unsub = subscribeMarketCreated({
      networkKey,
      onEvent: (log) => {
        try {
          // Filter by this season
          const ev = log?.args;
          if (ev && Number(ev.seasonId) === sid) {
            // Refresh list on new market
            load();
          }
        } catch {
          // Ignore event parsing errors
        }
      },
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [sid, networkKey]);

  return { markets, isLoading: loading, error };
}
