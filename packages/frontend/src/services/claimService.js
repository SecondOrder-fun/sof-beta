// src/services/claimService.js
//
// Claim service — builds { to, data } call objects for each claim type.
// The caller (a React component/hook) is responsible for passing these
// to executeBatch() from useSmartTransactions.
//
import { buildClaimGrandCall, buildClaimConsolationCall } from "./onchainRaffleDistributor";
import { buildClaimPayoutCall, buildRedeemPositionCall } from "./onchainInfoFi";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * Build the call object(s) for a given claim type.
 * Returns { calls: Array<{to, data}> } on success or { error: string } on failure.
 * The caller should execute: executeBatch(result.calls)
 *
 * @param {Object} opts
 * @param {string} opts.type - Claim type: "raffle-grand" | "raffle-consolation" | "infofi-payout" | "fpmm-position"
 * @param {Object} opts.params - Type-specific parameters
 * @param {string} [opts.networkKey] - Network key
 */
export async function buildClaimCalls({
  type,
  params,
  networkKey = getStoredNetworkKey(),
}) {
  try {
    switch (type) {
      case "raffle-grand": {
        const call = await buildClaimGrandCall({ seasonId: params.seasonId, networkKey });
        return { calls: [call], error: null };
      }

      case "raffle-consolation": {
        const call = await buildClaimConsolationCall({
          seasonId: params.seasonId,
          toRollover: params.toRollover ?? false,
          networkKey,
        });
        return { calls: [call], error: null };
      }

      case "infofi-payout": {
        const call = buildClaimPayoutCall({
          marketId: params.marketId,
          prediction: params.prediction,
          account: params.account,
          contractAddress: params.contractAddress,
        });
        return { calls: [call], error: null };
      }

      case "fpmm-position": {
        const call = await buildRedeemPositionCall({
          seasonId: params.seasonId,
          player: params.player,
          fpmmAddress: params.fpmmAddress,
          networkKey,
        });
        return { calls: [call], error: null };
      }

      default:
        return { calls: null, error: `Unknown claim type: ${type}` };
    }
  } catch (error) {
    return { calls: null, error: error.message };
  }
}
