/**
 * Contract Error Decoder for Buy/Sell Operations
 * Centralized error mapping for all transaction failures
 */

import { buildFriendlyContractError } from "@/lib/contractErrors";
import { SOFBondingCurveAbi } from "@/utils/abis";

/**
 * Comprehensive error map matching contract custom errors
 */
export const CONTRACT_ERROR_MAP = {
  CurveNotInitialized: "Bonding curve not initialized",
  CurveAlreadyInitialized: "Bonding curve already initialized",
  TradingLocked: "Trading is locked - Season has ended",
  TradingNotLocked: "Trading is not locked",
  AmountZero: "Amount must be greater than 0",
  AmountTooLarge: "Amount is too large",
  SlippageExceeded:
    "Price slippage exceeded - try increasing slippage tolerance",
  ExceedsMaxSupply: "Purchase would exceed maximum supply",
  InsufficientReserves: "Insufficient reserves in bonding curve",
  InsufficientSupply: "Insufficient supply to sell",
  InsufficientBalance: "Insufficient balance",
  InvalidAddress: "Invalid address provided",
  InvalidBondSteps: "Invalid bond steps configuration",
  InvalidBondStepRange: "Invalid bond step range",
  InvalidBondStepPrice: "Invalid bond step price",
  InvalidBondStepOrder: "Bond steps must be in ascending order",
  BondStepOverflow: "Bond step value overflow",
  RaffleAlreadySet: "Raffle contract already set",
  RaffleNotSet: "Raffle contract not set",
  FeeTooHigh: "Fee is too high",
  SeasonNotFound: "Season not found",
  SeasonNotActive: "Season is not active",
  SeasonNotEnded: "Season has not ended",
  SeasonAlreadyStarted: "Season already started",
  SeasonAlreadyEnded: "Season already ended",
  InvalidSeasonStatus: "Invalid season status",
  FactoryNotSet: "Season factory not set",
  DistributorNotSet: "Prize distributor not set",
  InvalidBasisPoints: "Invalid basis points value",
  InvalidSeasonName: "Season name cannot be empty",
  InvalidStartTime: "Start time must be in the future",
  InvalidEndTime: "End time must be after start time",
};

/**
 * Extract readable error message from contract error
 * @param {Error} err - The error object from contract interaction
 * @param {Function} t - i18n translation function
 * @returns {string} Human-readable error message
 */
export function getReadableContractError(err, t) {
  if (!err?.message) {
    return t?.("transactions:genericFailure", {
      defaultValue: "Transaction failed",
    }) || "Transaction failed";
  }

  // Check for custom error names in the message
  for (const [errorName, readableMsg] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (err.message.includes(errorName)) {
      return readableMsg;
    }
  }

  // Match common revert patterns
  const revertMatch = err.message.match(/revert (.*?)(?:\n|$)/);
  if (revertMatch?.[1]) {
    return revertMatch[1];
  }

  // Silent revert detection
  if (
    err.message.includes("execution reverted") &&
    !err.message.includes("reason")
  ) {
    return "Transaction failed - please check that the season is active and you have sufficient balance";
  }

  // Fallback to friendly contract error decoder
  return buildFriendlyContractError(
    SOFBondingCurveAbi,
    err,
    t?.("transactions:genericFailure", {
      defaultValue: "Transaction failed",
    }) || "Transaction failed"
  );
}
