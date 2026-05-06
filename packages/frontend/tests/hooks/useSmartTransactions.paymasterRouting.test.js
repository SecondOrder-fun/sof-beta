/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";

vi.stubEnv("VITE_API_BASE_URL", "https://api.test.com");

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: "0xabc", connector: { id: "metaMaskSDK" } })),
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
vi.mock("@/context/farcasterContext", async () => {
  const { createContext } = await import("react");
  return { default: createContext({ backendJwt: "mock-jwt" }) };
});

import { fetchPaymasterSession } from "@/hooks/useSmartTransactions";

// Path-A delegation routing tests were removed alongside the delegation
// hooks (gasless rewrite §4.4). The desktop-EOA branch will be reintroduced
// via permissionless.js in M4 with its own dedicated tests.

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
