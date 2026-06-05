// tests/services/fidResolverService.verifiedAddresses.test.js
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "node:process";

import { resolveFidVerifiedAddresses } from "../../shared/fidResolverService.js";

const FID = 12345;

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEYNAR_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEYNAR_API_KEY;
});

describe("resolveFidVerifiedAddresses", () => {
  it("returns all verified eth addresses plus custody (lowercased) via Neynar", async () => {
    process.env.NEYNAR_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        users: [
          {
            fid: FID,
            custody_address: "0xCccc000000000000000000000000000000000003",
            verified_addresses: {
              primary: { eth_address: "0xAAaa000000000000000000000000000000000001" },
              eth_addresses: [
                "0xAAaa000000000000000000000000000000000001",
                "0xBBbb000000000000000000000000000000000002",
              ],
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFidVerifiedAddresses(FID);

    expect(result).toEqual([
      "0xaaaa000000000000000000000000000000000001",
      "0xbbbb000000000000000000000000000000000002",
      "0xcccc000000000000000000000000000000000003",
    ]);
    // Neynar bulk endpoint was queried with the FID + api key header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(`fids=${FID}`);
    expect(opts.headers.api_key).toBe("test-key");
  });

  it("falls back to the Farcaster primary-address API when no Neynar key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          address: { address: "0xDDdd000000000000000000000000000000000004" },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFidVerifiedAddresses(FID);

    expect(result).toEqual([
      "0xdddd000000000000000000000000000000000004",
    ]);
  });

  it("returns an empty array when the FID has no resolvable addresses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ result: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFidVerifiedAddresses(FID);

    expect(result).toEqual([]);
  });

  it("returns an empty array when resolution throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFidVerifiedAddresses(FID);

    expect(result).toEqual([]);
  });

  it("de-duplicates addresses that appear in multiple fields", async () => {
    process.env.NEYNAR_API_KEY = "test-key";
    const SHARED = "0xEEee000000000000000000000000000000000005";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        users: [
          {
            fid: FID,
            custody_address: SHARED,
            verified_addresses: {
              primary: { eth_address: SHARED },
              eth_addresses: [SHARED],
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFidVerifiedAddresses(FID);

    expect(result).toEqual([SHARED.toLowerCase()]);
  });
});
