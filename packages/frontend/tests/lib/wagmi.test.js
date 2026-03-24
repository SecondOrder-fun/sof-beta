// tests/lib/wagmi.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getChainConfig,
  getStoredNetworkKey,
  setStoredNetworkKey,
} from "@/lib/wagmi";
import { NETWORKS, getDefaultNetworkKey } from "@/config/networks";

describe("lib/wagmi", () => {
  beforeEach(() => {
    // Reset localStorage between tests
    localStorage.clear();
  });

  it("getChainConfig returns defaults when no override provided", () => {
    const { key, chain, transport } = getChainConfig();
    const defaultKey = getDefaultNetworkKey();
    expect(key).toBe(defaultKey);
    expect(chain.id).toBe(NETWORKS[defaultKey].id);
    expect(chain.rpcUrls.default.http[0]).toBe(NETWORKS[defaultKey].rpcUrl);
    // viem http() transport is an object; basic sanity check
    expect(transport).toBeDefined();
  });

  it("setStoredNetworkKey persists and getStoredNetworkKey retrieves", () => {
    setStoredNetworkKey("TESTNET");
    expect(getStoredNetworkKey()).toBe("TESTNET");
  });

  it("getStoredNetworkKey falls back gracefully when storage throws", () => {
    // Simulate storage error
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    const key = getStoredNetworkKey();
    expect(["LOCAL", "TESTNET"]).toContain(key);
    spy.mockRestore();
  });
});
