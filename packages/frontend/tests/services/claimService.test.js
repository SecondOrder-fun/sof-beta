// tests/services/claimService.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeClaim,
  claimRaffleGrandPrize,
  claimRaffleConsolationPrize,
} from "@/services/claimService";
import * as onchainRaffleDistributor from "@/services/onchainRaffleDistributor";

// Mock the service modules
vi.mock("@/services/onchainRaffleDistributor");

describe("claimService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeClaim", () => {
    it("should route to raffle-grand claim correctly", async () => {
      const mockHash = "0x123...";
      onchainRaffleDistributor.claimGrand.mockResolvedValue(mockHash);

      const result = await executeClaim({
        type: "raffle-grand",
        params: { seasonId: 1 },
        networkKey: "LOCAL",
      });

      expect(result).toEqual({ success: true, hash: mockHash, error: null });
      expect(onchainRaffleDistributor.claimGrand).toHaveBeenCalledWith({
        seasonId: 1,
        networkKey: "LOCAL",
      });
    });

    it("should route to raffle-consolation claim correctly", async () => {
      const mockHash = "0x456...";
      onchainRaffleDistributor.claimConsolation.mockResolvedValue(mockHash);

      const result = await executeClaim({
        type: "raffle-consolation",
        params: { seasonId: 2 },
        networkKey: "LOCAL",
      });

      expect(result).toEqual({ success: true, hash: mockHash, error: null });
      expect(onchainRaffleDistributor.claimConsolation).toHaveBeenCalledWith({
        seasonId: 2,
        networkKey: "LOCAL",
      });
    });

    it("should handle claim errors correctly", async () => {
      const mockError = new Error("Insufficient funds");
      onchainRaffleDistributor.claimGrand.mockRejectedValue(mockError);

      const result = await executeClaim({
        type: "raffle-grand",
        params: { seasonId: 1 },
        networkKey: "LOCAL",
      });

      expect(result).toEqual({
        success: false,
        hash: null,
        error: "Insufficient funds",
      });
    });

    it("should handle unknown claim types", async () => {
      const result = await executeClaim({
        type: "unknown-type",
        params: { seasonId: 1 },
        networkKey: "LOCAL",
      });

      expect(result).toEqual({
        success: false,
        hash: null,
        error: "Unknown claim type: unknown-type",
      });
    });
  });

  describe("convenience functions", () => {
    it("should provide claimRaffleGrandPrize convenience function", async () => {
      const mockHash = "0x789...";
      onchainRaffleDistributor.claimGrand.mockResolvedValue(mockHash);

      const result = await claimRaffleGrandPrize({
        seasonId: 3,
        networkKey: "TESTNET",
      });

      expect(result).toEqual({ success: true, hash: mockHash, error: null });
      expect(onchainRaffleDistributor.claimGrand).toHaveBeenCalledWith({
        seasonId: 3,
        networkKey: "TESTNET",
      });
    });

    it("should provide claimRaffleConsolationPrize convenience function", async () => {
      const mockHash = "0xabc...";
      onchainRaffleDistributor.claimConsolation.mockResolvedValue(mockHash);

      const result = await claimRaffleConsolationPrize({
        seasonId: 4,
        networkKey: "TESTNET",
      });

      expect(result).toEqual({ success: true, hash: mockHash, error: null });
      expect(onchainRaffleDistributor.claimConsolation).toHaveBeenCalledWith({
        seasonId: 4,
        networkKey: "TESTNET",
      });
    });
  });
});
