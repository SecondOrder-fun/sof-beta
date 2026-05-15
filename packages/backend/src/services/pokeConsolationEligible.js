/**
 * @file pokeConsolationEligible.js
 * @description Standalone helper that reads a season's participants from chain
 * and calls Raffle.pokeConsolationEligible(seasonId, offset, limit) in chunks.
 *
 * Why this lives outside SeasonLifecycleService:
 *   Raffle.finalizeSeason is permissionless on-chain. ANY address can finalize
 *   a season once VRF words land — backend lifecycle service, admin UI manual
 *   call, an opportunistic bot, etc. If the poke step is coupled to the
 *   backend's finalize call, it only fires when the backend wins the race.
 *   Coupling it to the SeasonCompleted event listener instead makes the poke
 *   step trigger on the on-chain consequence, not the on-chain cause —
 *   independent of who finalized.
 *
 * The function is permissionless on-chain and idempotent on re-runs
 * (re-registering an already-eligible participant is a warm SSTORE, ~100 gas),
 * so a crash mid-chunk is safe — re-running is a no-op for the populated
 * prefix.
 */

import { publicClient, getWalletClient } from "../lib/viemClient.js";
import { RaffleABI as RaffleAbi } from "@sof/contracts";

const CHUNK_SIZE = 500n;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const TX_RECEIPT_TIMEOUT_MS = 60_000;

/**
 * Submit `pokeConsolationEligible(seasonId, offset, limit)` with retry.
 * Mirrors SeasonLifecycleService.submitWithRetry — same retry policy.
 * @param {object} ctx
 * @param {string} ctx.raffleAddress
 * @param {object} ctx.logger
 * @param {bigint} seasonId
 * @param {bigint} offset
 * @param {bigint} limit
 */
async function submitPokeChunk({ raffleAddress, logger }, seasonId, offset, limit) {
  const label = `📋 Season ${seasonId} poke [${offset}..${offset + limit}]`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const walletClient = getWalletClient();
      const hash = await walletClient.writeContract({
        address: raffleAddress,
        abi: RaffleAbi,
        functionName: "pokeConsolationEligible",
        args: [seasonId, offset, limit],
      });

      logger.info(`${label} TX submitted (attempt ${attempt}): ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: TX_RECEIPT_TIMEOUT_MS,
      });

      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted on-chain (hash: ${hash})`);
      }

      logger.info(`${label} TX confirmed: ${hash} (block ${receipt.blockNumber})`);
      return { hash, receipt };
    } catch (error) {
      lastError = error;
      logger.warn(`${label} attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        logger.info(`${label} retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Read participants for `seasonId` from the Raffle and call
 * pokeConsolationEligible in CHUNK_SIZE-sized slices.
 *
 * @param {object} params
 * @param {string} params.raffleAddress - Raffle contract address
 * @param {object} params.logger - Logger (info/warn/error)
 * @param {bigint|number} params.seasonId
 */
export async function pokeConsolationEligibleChunked({
  raffleAddress,
  logger,
  seasonId,
}) {
  if (!raffleAddress) throw new Error("raffleAddress is required");
  if (!logger) throw new Error("logger is required");
  if (seasonId === undefined || seasonId === null) {
    throw new Error("seasonId is required");
  }

  const sid = typeof seasonId === "bigint" ? seasonId : BigInt(seasonId);

  const participants = await publicClient.readContract({
    address: raffleAddress,
    abi: RaffleAbi,
    functionName: "getParticipants",
    args: [sid],
  });
  const length = BigInt(participants.length);

  if (length === 0n) {
    logger.info(`📋 Season ${sid} has no participants to poke`);
    return { chunks: 0, length: 0n };
  }

  logger.info(
    `📋 Poking ${length} participants for season ${sid} in chunks of ${CHUNK_SIZE}`
  );

  let chunks = 0;
  for (let offset = 0n; offset < length; offset += CHUNK_SIZE) {
    await submitPokeChunk({ raffleAddress, logger }, sid, offset, CHUNK_SIZE);
    chunks += 1;
  }

  return { chunks, length };
}
