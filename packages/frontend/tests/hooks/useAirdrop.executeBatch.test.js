// tests/hooks/useAirdrop.executeBatch.test.js
// Verify useAirdrop: backend relay API calls + on-chain verification
/* eslint-disable no-undef */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockSignMessage = vi.fn();

const mockInvalidateQueries = vi.fn();
const mockRefetchHasClaimed = vi.fn();
const mockRefetchLastDaily = vi.fn();

let hasClaimedValue = true; // default: already claimed (for daily tests)

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xUser", isConnected: true }),
  useWalletClient: () => ({
    data: { signMessage: mockSignMessage },
  }),
  useReadContract: vi.fn(({ functionName }) => {
    const defaults = {
      hasClaimed: { data: hasClaimedValue, refetch: mockRefetchHasClaimed },
      lastDailyClaim: { data: 0n, refetch: mockRefetchLastDaily },
      cooldown: { data: 0n },
      initialAmount: { data: 1000000000000000000000n },
      basicAmount: { data: 500000000000000000000n },
      dailyAmount: { data: 100000000000000000000n },
    };
    return defaults[functionName] || { data: undefined };
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF_AIRDROP: "0xAirdrop", SOF: "0xSOF" }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "testnet",
}));

vi.mock("@/utils/abis", () => ({
  SOFAirdropAbi: [],
}));

vi.mock("@/context/farcasterContext", () => ({
  default: { _currentValue: null },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useAirdrop - backend relay API calls + on-chain verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    hasClaimedValue = true;
    mockSignMessage.mockResolvedValue("0xSignature");
    // Default: hasClaimed returns true on first poll (tx already mined)
    mockRefetchHasClaimed.mockResolvedValue({ data: true });
    mockRefetchLastDaily.mockResolvedValue({ data: 0n });
    // Default: API returns success
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, hash: "0xRelayTxHash" }),
    });
  });

  test("claimDaily calls POST /airdrop/claim with type=daily", async () => {
    // For daily: lastDailyClaim poll returns a new timestamp
    mockRefetchLastDaily.mockResolvedValue({ data: 999n });

    const { useAirdrop } = await import("@/hooks/useAirdrop");
    const { result } = renderHook(() => useAirdrop());

    await act(async () => {
      await result.current.claimDaily();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain("/airdrop/claim");
    const body = JSON.parse(opts.body);
    expect(body.type).toBe("daily");
    expect(body.address).toBe("0xUser");
  });

  test("claimInitialBasic signs message and calls API with signature", async () => {
    hasClaimedValue = false;
    mockRefetchHasClaimed.mockResolvedValue({ data: true });

    const { useAirdrop } = await import("@/hooks/useAirdrop");
    const { result } = renderHook(() => useAirdrop());

    await act(async () => {
      await result.current.claimInitialBasic();
    });

    // Should have signed a message
    expect(mockSignMessage).toHaveBeenCalledTimes(1);
    expect(mockSignMessage).toHaveBeenCalledWith({
      message: "Claim SOF airdrop for 0xUser",
    });

    // Should have called API
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain("/airdrop/claim");
    const body = JSON.parse(opts.body);
    expect(body.type).toBe("basic");
    expect(body.signature).toBe("0xSignature");
    expect(body.address).toBe("0xUser");
  });

  test("claimInitialBasic shows success only after on-chain hasClaimed confirms", async () => {
    hasClaimedValue = false;
    let pollCount = 0;
    mockRefetchHasClaimed.mockImplementation(async () => {
      pollCount++;
      return { data: pollCount >= 2 };
    });

    const { useAirdrop } = await import("@/hooks/useAirdrop");
    const { result } = renderHook(() => useAirdrop());

    await act(async () => {
      await result.current.claimInitialBasic();
    });

    // Should have polled at least twice
    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(result.current.claimInitialState.isSuccess).toBe(true);
    expect(result.current.claimInitialState.isPending).toBe(false);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["sofBalance"] });
  });

  test("sets error when API returns non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Already claimed" }),
    });

    const { useAirdrop } = await import("@/hooks/useAirdrop");
    const { result } = renderHook(() => useAirdrop());

    await act(async () => {
      await result.current.claimInitialBasic();
    });

    expect(result.current.claimInitialState.isError).toBe(true);
    expect(result.current.claimInitialState.error).toContain("Already claimed");
  });

  test("sets error when wallet signMessage is rejected", async () => {
    hasClaimedValue = false;
    const userRejection = new Error("User rejected the request");
    mockSignMessage.mockRejectedValue(userRejection);

    const { useAirdrop } = await import("@/hooks/useAirdrop");
    const { result } = renderHook(() => useAirdrop());

    await act(async () => {
      await result.current.claimInitialBasic();
    });

    expect(result.current.claimInitialState.isError).toBe(true);
    expect(result.current.claimInitialState.error).toContain("User rejected");
    // Should NOT have called the API
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("shows error when tx accepted but on-chain state never changes", async () => {
    // hasClaimed always returns false (tx reverted on-chain)
    hasClaimedValue = false;
    mockRefetchHasClaimed.mockResolvedValue({ data: false });

    const { useAirdrop } = await import("@/hooks/useAirdrop");
    const { result } = renderHook(() => useAirdrop());

    await act(async () => {
      await result.current.claimInitialBasic();
    });

    expect(result.current.claimInitialState.isError).toBe(true);
    expect(result.current.claimInitialState.error).toContain("not confirmed on-chain");
  }, 35_000); // Allow time for the 30s polling timeout
});
