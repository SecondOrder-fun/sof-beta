// src/services/onchainRaffleDistributor.js
import { getAddress, encodeFunctionData } from "viem";
import { RaffleAbi, RafflePrizeDistributorAbi } from "@/utils/abis";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { buildPublicClient } from "@/lib/viemClient";

function buildClient(networkKey) {
  const client = buildPublicClient(networkKey);
  if (!client) {
    throw new Error("RPC URL missing for network");
  }
  return client;
}

export async function getPrizeDistributor({
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const { RAFFLE } = getContractAddresses(networkKey);
  if (!RAFFLE) throw new Error("RAFFLE address missing");
  const addr = await client.readContract({
    address: RAFFLE,
    abi: RaffleAbi,
    functionName: "prizeDistributor",
  });
  return addr;
}

export async function getSeasonPayouts({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000") return null;
  const data = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "getSeason",
    args: [BigInt(seasonId)],
  });
  return { distributor, seasonId, data };
}

/**
 * Build a { to, data } call object for claiming the grand prize.
 * Caller should pass this to executeBatch([call]).
 */
export async function buildClaimGrandCall({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const distributor = await getPrizeDistributor({ networkKey });
  return {
    to: distributor,
    data: encodeFunctionData({
      abi: RafflePrizeDistributorAbi,
      functionName: "claimGrand",
      args: [BigInt(seasonId)],
    }),
  };
}

/**
 * Build a { to, data } call object for claiming the consolation prize.
 * Caller should pass this to executeBatch([call]).
 */
export async function buildClaimConsolationCall({
  seasonId,
  toRollover = false,
  networkKey = getStoredNetworkKey(),
}) {
  const distributor = await getPrizeDistributor({ networkKey });
  return {
    to: distributor,
    data: encodeFunctionData({
      abi: RafflePrizeDistributorAbi,
      functionName: "claimConsolation",
      args: [BigInt(seasonId), toRollover],
    }),
  };
}

export async function isConsolationClaimed({
  seasonId,
  account,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000")
    return false;
  const claimed = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "isConsolationClaimed",
    args: [BigInt(seasonId), getAddress(account)],
  });
  return !!claimed;
}

// ── Tiered / Sponsored Prize functions ───────────────────────

export async function getTierConfigs({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000") return [];
  const tiers = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "getTierConfigs",
    args: [BigInt(seasonId)],
  });
  return tiers || [];
}

export async function getTierWinners({
  seasonId,
  tierIndex,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000") return [];
  const winners = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "getTierWinners",
    args: [BigInt(seasonId), BigInt(tierIndex)],
  });
  return winners || [];
}

export async function getWinnerTier({
  seasonId,
  account,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000") return { isTierWinner: false, tierIndex: 0 };
  const [isTierWinner, tierIndex] = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "getWinnerTier",
    args: [BigInt(seasonId), getAddress(account)],
  });
  return { isTierWinner, tierIndex: Number(tierIndex) };
}

export async function getSponsoredERC20({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000") return [];
  const prizes = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "getSponsoredERC20",
    args: [BigInt(seasonId)],
  });
  return prizes || [];
}

export async function getSponsoredERC721({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const distributor = await getPrizeDistributor({ networkKey });
  if (distributor === "0x0000000000000000000000000000000000000000") return [];
  const prizes = await client.readContract({
    address: distributor,
    abi: RafflePrizeDistributorAbi,
    functionName: "getSponsoredERC721",
    args: [BigInt(seasonId)],
  });
  return prizes || [];
}

/**
 * Build ERC-5792 batch calls for claiming sponsored ERC-20 prizes.
 * Returns { to, data } for use with executeBatch.
 */
export async function buildClaimSponsoredERC20Call({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const { encodeFunctionData } = await import("viem");
  const distributor = await getPrizeDistributor({ networkKey });
  return {
    to: distributor,
    data: encodeFunctionData({
      abi: RafflePrizeDistributorAbi,
      functionName: "claimSponsoredERC20",
      args: [BigInt(seasonId)],
    }),
  };
}

/**
 * Build ERC-5792 batch calls for claiming sponsored ERC-721 prizes.
 * Returns { to, data } for use with executeBatch.
 */
export async function buildClaimSponsoredERC721Call({
  seasonId,
  networkKey = getStoredNetworkKey(),
}) {
  const { encodeFunctionData } = await import("viem");
  const distributor = await getPrizeDistributor({ networkKey });
  return {
    to: distributor,
    data: encodeFunctionData({
      abi: RafflePrizeDistributorAbi,
      functionName: "claimSponsoredERC721",
      args: [BigInt(seasonId)],
    }),
  };
}

/**
 * Check if an account was a participant in a given season.
 * A participant is someone who has ticketCount > 0.
 * @param {Object} params
 * @param {number|string} params.seasonId - The season ID
 * @param {string} params.account - The account address to check
 * @param {string} [params.networkKey] - Network key
 * @returns {Promise<boolean>} - True if the account participated
 */
export async function isSeasonParticipant({
  seasonId,
  account,
  networkKey = getStoredNetworkKey(),
}) {
  const client = buildClient(networkKey);
  const { RAFFLE } = getContractAddresses(networkKey);
  if (!RAFFLE) return false;

  try {
    const position = await client.readContract({
      address: RAFFLE,
      abi: RaffleAbi,
      functionName: "getParticipantPosition",
      args: [BigInt(seasonId), getAddress(account)],
    });
    // A participant has ticketCount > 0
    return position && BigInt(position.ticketCount) > 0n;
  } catch {
    return false;
  }
}
