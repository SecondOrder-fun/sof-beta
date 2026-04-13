/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockSendCallsAsync = vi.fn();
const mockSendUserOperation = vi.fn().mockResolvedValue("0xUserOpHash");
const mockWaitForReceipt = vi.fn().mockResolvedValue({ userOpHash: "0xReceiptHash" });

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: "0xabc", connector: { id: "metaMaskSDK" } })),
  useChainId: () => 8453,
  useCapabilities: () => ({ data: {} }),
  useSendCalls: () => ({ sendCallsAsync: mockSendCallsAsync, data: undefined }),
  useCallsStatus: () => ({ data: undefined, query: {} }),
}));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF: "0xSOF", SOF_EXCHANGE: "0xExchange" }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET", getChainConfig: () => ({ chain: { id: 84532 }, transport: {} }) }));
vi.mock("@/lib/wagmiConfig", () => ({ config: {}, initialNetworkKey: "TESTNET" }));
vi.mock("@/context/farcasterContext", () => ({ default: null }));
vi.mock("@/hooks/useDelegationStatus", () => ({
  useDelegationStatus: vi.fn(() => ({ isSOFDelegate: false, isDelegated: false })),
}));
vi.mock("@/hooks/useDelegatedAccount", () => ({
  useDelegatedAccount: vi.fn(() => null),
}));

import { fetchPaymasterSession, useSmartTransactions } from "@/hooks/useSmartTransactions";
import { useDelegationStatus } from "@/hooks/useDelegationStatus";
import { useDelegatedAccount } from "@/hooks/useDelegatedAccount";
import { useAccount } from "wagmi";

describe("fetchPaymasterSession", () => {
  it("returns sessionToken on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionToken: "abc123" }),
    });
    const token = await fetchPaymasterSession("https://api.example.com", "jwt");
    expect(token).toBe("abc123");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/paymaster/session",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt" }),
      }),
    );
    vi.restoreAllMocks();
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false });
    const token = await fetchPaymasterSession("https://api.example.com", "jwt");
    expect(token).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));
    const token = await fetchPaymasterSession("https://api.example.com", "jwt");
    expect(token).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("useSmartTransactions — Path A (delegated EOA)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendCallsAsync.mockResolvedValue("0xBatchId");
  });

  it("returns isDelegated=true and needsDelegation=false when EOA is delegated", () => {
    useDelegationStatus.mockReturnValue({ isSOFDelegate: true, isDelegated: true });
    useDelegatedAccount.mockReturnValue({ create: vi.fn(), address: "0xabc", chainId: 8453 });

    const { result } = renderHook(() => useSmartTransactions());
    expect(result.current.isDelegated).toBe(true);
    expect(result.current.needsDelegation).toBe(false);
  });

  it("returns needsDelegation=true for non-CB non-delegated EOA", () => {
    useDelegationStatus.mockReturnValue({ isSOFDelegate: false, isDelegated: false });
    useDelegatedAccount.mockReturnValue(null);

    const { result } = renderHook(() => useSmartTransactions());
    expect(result.current.needsDelegation).toBe(true);
    expect(result.current.isDelegated).toBe(false);
  });

  it("returns needsDelegation=false for Coinbase Wallet", () => {
    useDelegationStatus.mockReturnValue({ isSOFDelegate: false, isDelegated: false });
    useDelegatedAccount.mockReturnValue(null);
    useAccount.mockReturnValue({ address: "0xabc", connector: { id: "coinbaseWalletSDK" } });

    const { result } = renderHook(() => useSmartTransactions());
    expect(result.current.needsDelegation).toBe(false);

    // Restore default mock
    useAccount.mockReturnValue({ address: "0xabc", connector: { id: "metaMaskSDK" } });
  });

  it("routes delegated EOA through Path A (sendUserOperation)", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      sendUserOperation: mockSendUserOperation,
      waitForUserOperationReceipt: mockWaitForReceipt,
    });
    useDelegationStatus.mockReturnValue({ isSOFDelegate: true, isDelegated: true });
    useDelegatedAccount.mockReturnValue({ create: mockCreate, address: "0xabc", chainId: 8453 });

    // Mock session token fetch
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionToken: "session123" }),
    });

    const { result } = renderHook(() => useSmartTransactions());

    let returnValue;
    await act(async () => {
      returnValue = await result.current.executeBatch(
        [{ to: "0xTarget", data: "0x" }],
        { sofAmount: 0n },
      );
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(mockSendUserOperation).toHaveBeenCalledWith({
      calls: [{ to: "0xTarget", data: "0x" }],
    });
    expect(mockWaitForReceipt).toHaveBeenCalled();
    expect(returnValue).toBe("0xReceiptHash");

    vi.restoreAllMocks();
  });

  it("falls through to Path B when session token unavailable for delegated EOA", async () => {
    const mockCreate = vi.fn();
    useDelegationStatus.mockReturnValue({ isSOFDelegate: true, isDelegated: true });
    useDelegatedAccount.mockReturnValue({ create: mockCreate, address: "0xabc", chainId: 8453 });

    // Mock session token fetch returning null
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useSmartTransactions());

    await act(async () => {
      try {
        await result.current.executeBatch([{ to: "0xTarget", data: "0x" }]);
      } catch {
        // sendCallsAsync may reject in test — that's fine
      }
    });

    // Path A should NOT have been called (no session token)
    expect(mockCreate).not.toHaveBeenCalled();
    // Path B (sendCallsAsync) should have been attempted
    expect(mockSendCallsAsync).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
