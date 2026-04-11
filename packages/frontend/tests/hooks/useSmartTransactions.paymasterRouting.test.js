/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", connector: { id: "metaMaskSDK" } }),
  useChainId: () => 8453,
  useCapabilities: () => ({ data: {} }),
  useSendCalls: () => ({ sendCallsAsync: vi.fn(), data: undefined }),
  useCallsStatus: () => ({ data: undefined, query: {} }),
}));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF: "0xSOF", SOF_EXCHANGE: "0xExchange" }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET", getChainConfig: () => ({ chain: { id: 84532 }, transport: {} }) }));
vi.mock("@/lib/wagmiConfig", () => ({ config: {}, initialNetworkKey: "TESTNET" }));
vi.mock("@/context/farcasterContext", () => ({ default: null }));

import { fetchPaymasterSession } from "@/hooks/useSmartTransactions";

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
