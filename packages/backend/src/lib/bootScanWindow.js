/**
 * bootScanWindow
 *
 * The block window a listener's boot scan covers, and where its live poller
 * starts when that scan did not complete. Shared by the launch listeners,
 * whose events cannot be re-read later, so no block may fall between the scan
 * and the poller:
 *
 *   - scan completed over [from, head]      -> poller no later than head + 1
 *   - scan failed at block X                -> poller no later than X
 *   - scan failed before it knew its window -> the stored cursor, or else the
 *                                              lookback window's first block
 */

import { getChainByKey } from "../config/chain.js";

/**
 * The last `lookbackBlocks` of the chain, up to the current head.
 * @param {{ getBlockNumber: () => Promise<bigint> }} client
 * @returns {Promise<{ head: bigint, from: bigint }>}
 */
export async function lookbackWindow(client) {
  const head = await client.getBlockNumber();
  const lookback = getChainByKey(process.env.NETWORK).lookbackBlocks;
  return { head, from: head > lookback ? head - lookback : 0n };
}

/**
 * The poller's `resumeNoLaterThan` for a boot scan that failed before it
 * learned its window (the head or chain config read threw). With a stored
 * cursor, the cursor is the resume point (undefined). Without one the poller
 * would start at the head and skip the window, so the window is read again;
 * if that fails too this throws, as the poller's own head read would.
 *
 * @param {{ getBlockNumber: () => Promise<bigint> }} client
 * @param {{ get: () => Promise<bigint | null> }} blockCursor
 * @returns {Promise<bigint | undefined>}
 */
export async function resumeWithoutWindow(client, blockCursor) {
  const stored = await blockCursor.get();
  if (stored !== null && stored !== undefined) return undefined;
  return (await lookbackWindow(client)).from;
}
