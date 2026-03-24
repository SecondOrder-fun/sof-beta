// src/hooks/useInfoFiSocket.js
// Subscribes to backend WebSocket for InfoFi updates and exposes latest messages
import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribe } from '@/lib/wsClient';

/**
 * useInfoFiSocket
 * - Listens to WS messages
 * - Tracks connection status
 * - Caches last MARKET_UPDATE per marketId and last RAFFLE_UPDATE per player
 */
export function useInfoFiSocket() {
  const [status, setStatus] = useState('init');
  const marketUpdates = useRef(new Map()); // marketId -> payload
  const raffleUpdates = useRef(new Map()); // key `${seasonId}:${player}` -> payload
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'WS_STATUS') {
        setStatus(msg.status);
        return;
      }
      if (msg.type === 'MARKET_UPDATE' && msg.payload) {
        const mId = msg.payload.market_id ?? msg.payload.marketId;
        if (mId !== undefined && mId !== null) {
          marketUpdates.current.set(String(mId), msg.payload);
          force((x) => x + 1);
        }
        return;
      }
      if (msg.type === 'RAFFLE_UPDATE' && msg.payload) {
        const sId = msg.payload.seasonId ?? msg.payload.season_id;
        const player = (msg.payload.player || '').toLowerCase();
        if (sId !== undefined && player) {
          raffleUpdates.current.set(`${sId}:${player}`, msg.payload);
          force((x) => x + 1);
        }
      }
    });
    return () => unsub();
  }, []);

  const api = useMemo(() => ({
    status,
    getMarketUpdate: (marketId) => marketUpdates.current.get(String(marketId)) || null,
    getRaffleUpdate: (seasonId, player) => raffleUpdates.current.get(`${seasonId}:${(player||'').toLowerCase()}`) || null,
  }), [status]);

  return api;
}
