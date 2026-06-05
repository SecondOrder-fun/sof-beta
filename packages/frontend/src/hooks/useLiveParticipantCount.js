import { useMemo } from "react";
import { useLiveSubscription } from "@/hooks/chain/useLiveSubscription";

/**
 * Live unique-participant count for an active season. Reads the latest
 * `totalParticipants` straight off the `raffle`-channel `ConsolationPoolUpdated`
 * event (emitted by the backend on every PositionUpdate while Active), falling
 * back to `initialCount` until the first event arrives.
 *
 * @param {number|string|null} seasonId
 * @param {{ enabled?: boolean, initialCount?: number }} [opts]
 * @returns {number}
 */
export function useLiveParticipantCount(seasonId, { enabled = true, initialCount = 0 } = {}) {
  const { lastEvent } = useLiveSubscription({
    channel: "raffle",
    enabled: enabled && seasonId != null,
    filter: (e) =>
      e?.type === "ConsolationPoolUpdated" &&
      Number(e?.seasonId) === Number(seasonId),
  });

  return useMemo(() => {
    const live = lastEvent?.totalParticipants;
    const liveNum = Number(live);
    if (live != null && Number.isFinite(liveNum)) return liveNum;
    return Number(initialCount) || 0;
  }, [lastEvent, initialCount]);
}
