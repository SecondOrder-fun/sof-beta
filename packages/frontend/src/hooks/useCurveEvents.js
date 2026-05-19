// src/hooks/useCurveEvents.js
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';

/**
 * Subscribes to PositionUpdate events on a bonding curve via the raffle
 * SSE channel. The handler receives an event object whose shape mirrors the
 * backend broadcast payload rather than a viem log. Consumers that
 * previously read log.args should read event fields directly.
 *
 *   event = {
 *     type: 'PositionUpdate',
 *     bondingCurveAddress,
 *     seasonId, player,
 *     oldTickets, newTickets, totalTickets,
 *     blockNumber, txHash,
 *   }
 */
export function useCurveEvents(bondingCurveAddress, { onPositionUpdate } = {}) {
  const lowerAddr = bondingCurveAddress ? bondingCurveAddress.toLowerCase() : '';
  useLiveSubscription({
    channel: 'raffle',
    enabled: !!bondingCurveAddress,
    filter: (e) =>
      e.type === 'PositionUpdate' &&
      e.bondingCurveAddress?.toLowerCase() === lowerAddr,
    onEvent: (e) => {
      onPositionUpdate?.(e);
    },
  });
}
