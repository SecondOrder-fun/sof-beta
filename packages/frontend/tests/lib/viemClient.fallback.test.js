/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({
    id: 84532,
    name: "Base Sepolia",
    rpcUrl: "",
    rpcFallbackUrls: [
      "https://base-sepolia.drpc.org",
      "https://base-sepolia-public.nodies.app",
    ],
  }),
}));

const createPublicClientMock = vi.fn(() => ({ multicall: vi.fn() }));
const httpMock = vi.fn((url) => {
  const transport = () => undefined;
  // eslint-disable-next-line no-underscore-dangle
  transport.__url = url;
  return transport;
});
const fallbackMock = vi.fn((transports) => ({ transports }));

vi.mock("viem", () => ({
  createPublicClient: createPublicClientMock,
  http: httpMock,
  fallback: fallbackMock,
}));

describe("buildPublicClient", () => {
  it("uses the first rpcFallbackUrls entry when primary rpcUrl is missing", async () => {
    const { buildPublicClient } = await import("@/lib/viemClient");

    const client = buildPublicClient("TESTNET");
    expect(client).not.toBeNull();

    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
    const callArg = createPublicClientMock.mock.calls[0]?.[0];

    expect(callArg.chain.id).toBe(84532);
    expect(callArg.chain.rpcUrls.default.http[0]).toBe(
      "https://base-sepolia.drpc.org",
    );

    // Transport should still be constructed from fallback URLs.
    expect(httpMock).toHaveBeenCalledWith(
      "https://base-sepolia.drpc.org",
      expect.anything(),
    );
    expect(httpMock.mock.results[0].value).toEqual(
      expect.objectContaining({ __url: "https://base-sepolia.drpc.org" }),
    );
  });
});
