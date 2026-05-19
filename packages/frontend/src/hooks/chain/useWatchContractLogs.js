// src/hooks/chain/useWatchContractLogs.js
//
// Drop-in replacement for wagmi's useWatchContractEvent that uses
// eth_getLogs polling with a locally-maintained block cursor instead of
// eth_newFilter / eth_getFilterChanges. The filter setup wagmi does on
// mount is a one-shot RPC that gets rate-limited on cold load — the
// initial paint of a page with 6+ watchers spends most of its RPC budget
// here. Polling getLogs at a sane interval lets multiple concurrent
// watchers batch into a single JSON-RPC POST via the transport's
// `batch: true` aggregator.
//
// API matches useWatchContractEvent for the common shape:
//   { address, abi, eventName, args?, enabled?, onLogs }
// Returns nothing — set up the subscription via mount, cancel on unmount.
//
// Caller contract:
//  - onLogs receives the raw viem decoded log array (same shape wagmi
//    delivers). The hook keeps the latest onLogs in a ref so callback
//    identity changes don't restart polling.
//  - First tick seeds the cursor at the current block; it does not
//    replay history. If you need historical events, use queryLogsInChunks
//    from utils/blockRangeQuery (one-shot) and combine with this hook for
//    live updates.

import { useEffect, useRef } from "react";
import { usePublicClient } from "wagmi";

const DEFAULT_POLL_MS = 12_000;

function findEventAbi(abi, eventName) {
  if (!Array.isArray(abi) || !eventName) return null;
  return abi.find(
    (item) => item?.type === "event" && item?.name === eventName,
  );
}

export function useWatchContractLogs({
  address,
  abi,
  eventName,
  args,
  enabled = true,
  onLogs,
  pollIntervalMs = DEFAULT_POLL_MS,
}) {
  const publicClient = usePublicClient();
  const onLogsRef = useRef(onLogs);

  useEffect(() => {
    onLogsRef.current = onLogs;
  }, [onLogs]);

  // Stringify args so the effect dependency picks up structural changes
  // without triggering on every render that produces a new object identity.
  const argsKey = args == null ? null : JSON.stringify(args, (_, v) =>
    typeof v === "bigint" ? `${v.toString()}n` : v,
  );

  useEffect(() => {
    if (!enabled) return undefined;
    if (!publicClient) return undefined;
    if (!address) return undefined;
    if (!eventName) return undefined;

    const event = findEventAbi(abi, eventName);
    if (!event) return undefined;

    let cancelled = false;
    let timeoutId = null;
    let cursor = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const tip = await publicClient.getBlockNumber();
        if (cursor == null) {
          // Seed at the current block — don't replay history.
          cursor = tip;
        } else if (tip > cursor) {
          const logs = await publicClient.getLogs({
            address,
            event,
            args: args ?? undefined,
            fromBlock: cursor + 1n,
            toBlock: tip,
          });
          if (logs.length > 0 && !cancelled) {
            onLogsRef.current?.(logs);
          }
          cursor = tip;
        }
      } catch {
        // Swallow — a failed tick should not kill the poll loop. Common
        // transient failures: 429 rate-limit, network hiccup. Next tick
        // will retry with the same cursor.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(tick, pollIntervalMs);
        }
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, address, eventName, argsKey, enabled, pollIntervalMs]);
}
