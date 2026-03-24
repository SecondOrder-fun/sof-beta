// Testable helper to normalize incoming SSE payload keys to *Bps fields
export function normalizePricingMessage(msg) {
  if (!msg || typeof msg !== "object") {
    return {
      hybridPriceBps: undefined,
      raffleProbabilityBps: undefined,
      marketSentimentBps: undefined,
      lastUpdated: undefined,
    };
  }
  // Support nested payloads: { type, pricing: {...} }
  const src =
    msg.pricing && typeof msg.pricing === "object" ? msg.pricing : msg;

  const hybrid =
    typeof src.hybridPriceBps === "number"
      ? src.hybridPriceBps
      : typeof src.hybrid_price_bps === "number"
      ? src.hybrid_price_bps
      : typeof src.hybrid_price === "number"
      ? src.hybrid_price
      : typeof src.hybridPrice === "number"
      ? src.hybridPrice
      : undefined;

  const raffle =
    typeof src.raffleProbabilityBps === "number"
      ? src.raffleProbabilityBps
      : typeof src.raffle_probability_bps === "number"
      ? src.raffle_probability_bps
      : typeof src.raffle_probability === "number"
      ? src.raffle_probability
      : typeof src.raffleProbability === "number"
      ? src.raffleProbability
      : undefined;

  const sentiment =
    typeof src.marketSentimentBps === "number"
      ? src.marketSentimentBps
      : typeof src.market_sentiment_bps === "number"
      ? src.market_sentiment_bps
      : typeof src.market_sentiment === "number"
      ? src.market_sentiment
      : typeof src.marketSentiment === "number"
      ? src.marketSentiment
      : undefined;

  const lastUpdated = src.last_updated || src.lastUpdated || msg.timestamp;

  return {
    hybridPriceBps: hybrid,
    raffleProbabilityBps: raffle,
    marketSentimentBps: sentiment,
    lastUpdated,
  };
}

// src/hooks/usePricingStream.js
import { useCallback, useMemo, useState } from "react";
import { isValidMarketId } from "@/lib/marketId";
import { useSSE } from "./useSSE";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * usePricingStream
 * Subscribes to hybrid pricing SSE for a given InfoFi market.
 * Returns live bps fields and connection status.
 *
 * @param {string|number|null} marketId
 * @returns {{
 *   data: {
 *     marketId: string|number|null,
 *     hybridPriceBps: number|null,
 *     raffleProbabilityBps: number|null,
 *     marketSentimentBps: number|null,
 *     lastUpdated: string|null,
 *   },
 *   isConnected: boolean,
 *   error: any,
 *   reconnect: () => void,
 * }}
 */
export const usePricingStream = (marketId) => {
  const [state, setState] = useState({
    marketId: marketId ?? null,
    hybridPriceBps: null,
    raffleProbabilityBps: null,
    marketSentimentBps: null,
    lastUpdated: null,
  });

  const onMessage = useCallback(
    (msg) => {
      if (!msg) return;
      if (msg.type === "heartbeat") return;

      // Accept both initial and update events
      if (
        msg.type === "initial" ||
        msg.type === "update" ||
        msg.type === "initial_price" ||
        msg.type === "raffle_probability_update" ||
        msg.type === "market_sentiment_update"
      ) {
        // Normalize keys from nested/camel/snake payloads
        const {
          hybridPriceBps: hybrid,
          raffleProbabilityBps: raffle,
          marketSentimentBps: sentiment,
          lastUpdated,
        } = normalizePricingMessage(msg);
        setState((prev) => ({
          marketId: msg.marketId ?? prev.marketId ?? marketId ?? null,
          hybridPriceBps:
            typeof hybrid === "number" ? hybrid : prev.hybridPriceBps,
          raffleProbabilityBps:
            typeof raffle === "number" ? raffle : prev.raffleProbabilityBps,
          marketSentimentBps:
            typeof sentiment === "number" ? sentiment : prev.marketSentimentBps,
          lastUpdated: lastUpdated ?? prev.lastUpdated,
        }));
      }
    },
    [marketId]
  );

  const url = useMemo(() => {
    if (!marketId && marketId !== 0) return null;
    const idStr = String(marketId);
    // Accept either canonical marketId (e.g. "0:WINNER_PREDICTION:-") OR a numeric DB id (e.g. "5")
    const isNumericId = /^\d+$/.test(idStr);
    if (!isNumericId && !isValidMarketId(idStr)) return null;
    return `${API_BASE}/infofi/markets/${idStr}/pricing-stream`;
  }, [marketId]);

  const { isConnected, error, reconnect } = useSSE(url, onMessage, {
    withCredentials: false,
    maxRetries: 6,
    retryInterval: 2000,
    heartbeatInterval: 30000,
  });

  return {
    data: state,
    isConnected,
    error,
    reconnect,
  };
};
