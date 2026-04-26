/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.stubEnv("VITE_API_BASE_URL", "https://api.test.com");

const mockSendCallsAsync = vi.fn();
const mockSendUserOperation = vi.fn().mockResolvedValue("0xUserOpHash");
// Path A returns the wrapping handleOps tx hash (not the userOpHash), since
// callers feed it into useWaitForTransactionReceipt which expects an on-chain
// tx hash. permissionless's waitForUserOperationReceipt resolves to a populated
// receipt — match that shape so the hook's `receipt?.receipt?.transactionHash`
// path resolves cleanly.
const mockWaitForReceipt = vi.fn().mockResolvedValue({
  userOpHash: "0xUserOpHash",
  receipt: { transactionHash: "0xOnChainTxHash" },
});

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
vi.mock("@/context/farcasterContext", async () => {
  const { createContext } = await import("react");
  return { default: createContext({ backendJwt: "mock-jwt" }) };
});
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
    mockSendUserOperation.mockResolvedValue("0xUserOpHash");
    mockWaitForReceipt.mockResolvedValue({
      userOpHash: "0xUserOpHash",
      receipt: { transactionHash: "0xOnChainTxHash" },
    });
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
    // Path A returns the wrapping handleOps tx hash, NOT the userOpHash. The
    // UI feeds this into useWaitForTransactionReceipt, which would poll a
    // userOpHash forever (it's an EIP-4337 identifier, not an on-chain hash).
    expect(returnValue).toBe("0xOnChainTxHash");

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

  it("falls through to Path B when bundler returns a receipt without a tx hash", async () => {
    // PR #28 added a defensive throw: if waitForUserOperationReceipt resolves
    // with a receipt that has no on-chain transactionHash (a bundler bug),
    // Path A throws and the hook falls back to Path B rather than returning
    // a userOpHash that the UI can't resolve. Pin that contract here so a
    // future refactor can't quietly drop the throw.
    const mockCreate = vi.fn().mockResolvedValue({
      sendUserOperation: mockSendUserOperation,
      // Receipt missing the nested `receipt.transactionHash` — exactly the
      // shape the hook treats as "bundler bug" and falls back from.
      waitForUserOperationReceipt: vi.fn().mockResolvedValue({ userOpHash: "0xUserOpHash" }),
    });
    useDelegationStatus.mockReturnValue({ isSOFDelegate: true, isDelegated: true });
    useDelegatedAccount.mockReturnValue({ create: mockCreate, address: "0xabc", chainId: 8453 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionToken: "session123" }),
    });

    const { result } = renderHook(() => useSmartTransactions());
    await act(async () => {
      try {
        await result.current.executeBatch([{ to: "0xTarget", data: "0x" }]);
      } catch {
        // sendCallsAsync may reject — that's fine, we're asserting Path B fired
      }
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(mockSendCallsAsync).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
