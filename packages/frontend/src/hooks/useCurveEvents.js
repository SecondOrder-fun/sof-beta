// src/hooks/useCurveEvents.js
// Listen to SOFBondingCurve PositionUpdate events and invoke a callback.

import { useEffect } from "react";
import { usePublicClient } from "wagmi";

/**
 * Subscribes to PositionUpdate events on a bonding curve and calls the handler.
 * @param {string} bondingCurveAddress
 * @param {{ onPositionUpdate?: (log: any) => void }} opts
 */
export function useCurveEvents(bondingCurveAddress, { onPositionUpdate } = {}) {
  const client = usePublicClient();

  useEffect(() => {
    if (!bondingCurveAddress) return;
    if (!client) return;

    let unwatch = null;

    let mounted = true;
    (async () => {
      try {
        const SOFBondingCurveJson = (
          await import("@/contracts/abis/SOFBondingCurve.json")
        ).default;
        const SOFBondingCurveAbi =
          SOFBondingCurveJson?.abi ?? SOFBondingCurveJson;
        // watch for PositionUpdate(seasonId, player, oldTickets, newTickets, totalTickets)
        unwatch = client.watchContractEvent({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          eventName: "PositionUpdate",
          poll: true,
          onLogs: (logs) => {
            if (!mounted || !logs?.length) return;
            for (const log of logs) {
              try {
                onPositionUpdate && onPositionUpdate(log);
              } catch (_) {
                /* swallow */
              }
            }
          },
        });
      } catch (_e) {
        // non-fatal
      }
    })();

    return () => {
      mounted = false;
      try {
        unwatch && unwatch();
      } catch (_) {
        /* noop */
      }
    };
  }, [bondingCurveAddress, client, onPositionUpdate]);
}
