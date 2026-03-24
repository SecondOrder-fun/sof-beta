// src/services/claimService.js
import { claimGrand, claimConsolation } from "./onchainRaffleDistributor";
import { claimPayoutTx, redeemPositionTx } from "./onchainInfoFi";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * Unified claim service that provides consistent wallet interaction
 * for all claim types (raffle prizes and InfoFi market winnings)
 */

// Raffle Prize Claims
export async function claimRaffleGrandPrize({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  try {
    const hash = await claimGrand({ seasonId, networkKey });
    return { success: true, hash, error: null };
  } catch (error) {
    return { success: false, hash: null, error: error.message };
  }
}

export async function claimRaffleConsolationPrize({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  try {
    const hash = await claimConsolation({ seasonId, networkKey });
    return { success: true, hash, error: null };
  } catch (error) {
    return { success: false, hash: null, error: error.message };
  }
}

// InfoFi Market Claims
export async function claimInfoFiPayout({
  marketId,
  prediction,
  contractAddress,
  networkKey = getStoredNetworkKey(),
}) {
  try {
    const hash = await claimPayoutTx({
      marketId,
      prediction,
      contractAddress,
      networkKey,
    });
    return { success: true, hash, error: null };
  } catch (error) {
    return { success: false, hash: null, error: error.message };
  }
}

export async function claimFPMMPosition({
  seasonId,
  player,
  fpmmAddress,
  networkKey = getStoredNetworkKey(),
}) {
  try {
    const hash = await redeemPositionTx({ seasonId, player, fpmmAddress, networkKey });
    return { success: true, hash, error: null };
  } catch (error) {
    return { success: false, hash: null, error: error.message };
  }
}

// Unified claim handler that routes to the appropriate service
export async function executeClaim({
  type,
  params,
  networkKey = getStoredNetworkKey(),
}) {
  switch (type) {
    case "raffle-grand":
      return claimRaffleGrandPrize({ seasonId: params.seasonId, networkKey });

    case "raffle-consolation":
      return claimRaffleConsolationPrize({
        seasonId: params.seasonId,
        networkKey,
      });

    case "infofi-payout":
      return claimInfoFiPayout({
        marketId: params.marketId,
        prediction: params.prediction,
        contractAddress: params.contractAddress,
        networkKey,
      });

    case "fpmm-position":
      return claimFPMMPosition({
        seasonId: params.seasonId,
        player: params.player,
        fpmmAddress: params.fpmmAddress,
        networkKey,
      });

    default:
      return {
        success: false,
        hash: null,
        error: `Unknown claim type: ${type}`,
      };
  }
}
