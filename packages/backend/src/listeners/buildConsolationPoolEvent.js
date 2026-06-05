/**
 * Build the `ConsolationPoolUpdated` SSE payload broadcast on the `raffle`
 * channel on every PositionUpdate while a season is Active (issue #106).
 * The frontend derives Grand/Consolation amounts from live curve reserves;
 * this event's primary job is delivering the live `totalParticipants` count.
 *
 * @param {{ seasonId: number, participantCount: number|undefined,
 *           reservesWei: bigint|string|undefined, blockNumber: number,
 *           txHash: string }} args
 */
export function buildConsolationPoolEvent({
  seasonId,
  participantCount,
  reservesWei,
  blockNumber,
  txHash,
}) {
  let poolWei = "0";
  try {
    poolWei = BigInt(reservesWei ?? 0n).toString();
  } catch {
    poolWei = "0";
  }
  return {
    type: "ConsolationPoolUpdated",
    seasonId,
    totalParticipants: Number(participantCount) || 0,
    totalPoolWei: poolWei,
    blockNumber,
    txHash,
  };
}
