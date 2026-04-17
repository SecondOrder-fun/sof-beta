// src/services/onchainRolloverEscrow.js
import { encodeFunctionData } from "viem";
import { RolloverEscrowABI } from "@sof/contracts";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

export function getRolloverEscrowAddress(networkKey = getStoredNetworkKey()) {
  return getContractAddresses(networkKey).ROLLOVER_ESCROW;
}

export async function readUserPosition({ publicClient, seasonId, address, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return null;

  const [deposited, spent, refunded] = await publicClient.readContract({
    address: escrow,
    abi: RolloverEscrowABI,
    functionName: "getUserPosition",
    args: [BigInt(seasonId), address],
  });

  return { deposited, spent, refunded };
}

export async function readCohortState({ publicClient, seasonId, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return null;

  const [phase, nextSeasonId, bonusBps, totalDeposited, totalSpent, totalBonusPaid, isExpired] =
    await publicClient.readContract({
      address: escrow,
      abi: RolloverEscrowABI,
      functionName: "getCohortState",
      args: [BigInt(seasonId)],
    });

  const phaseNames = ["none", "open", "active", "closed", "expired"];

  return {
    phase: isExpired ? "expired" : phaseNames[Number(phase)] || "none",
    nextSeasonId,
    bonusBps,
    totalDeposited,
    totalSpent,
    totalBonusPaid,
  };
}

export async function readAvailableBalance({ publicClient, seasonId, address, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return 0n;

  return publicClient.readContract({
    address: escrow,
    abi: RolloverEscrowABI,
    functionName: "getAvailableBalance",
    args: [BigInt(seasonId), address],
  });
}

export async function readBonusAmount({ publicClient, seasonId, amount, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return 0n;

  return publicClient.readContract({
    address: escrow,
    abi: RolloverEscrowABI,
    functionName: "getBonusAmount",
    args: [BigInt(seasonId), amount],
  });
}

export function buildSpendFromRolloverCall({ seasonId, sofAmount, ticketAmount, maxTotalSof, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) throw new Error("RolloverEscrow address not configured");
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: RolloverEscrowABI,
      functionName: "spendFromRollover",
      args: [BigInt(seasonId), sofAmount, ticketAmount, maxTotalSof],
    }),
  };
}

export function buildRefundCall({ seasonId, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) throw new Error("RolloverEscrow address not configured");
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: RolloverEscrowABI,
      functionName: "refund",
      args: [BigInt(seasonId)],
    }),
  };
}
