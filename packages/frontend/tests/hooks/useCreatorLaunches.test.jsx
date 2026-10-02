/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const WALLET = "0x6666666666666666666666666666666666666666";
const CHECKSUMMED = "0xAbCd00000000000000000000000000000000AbCd";
const A = "0xAAAA00000000000000000000000000000000aaaa";

const reads = [];
const byCreator = {};
vi.mock("@/hooks/chain/useWarmRead", () => ({
  useWarmRead: (opts) => {
    reads.push(opts);
    return opts.enabled ? { data: { launches: byCreator[opts.params.creator] ?? [] }, isLoading: false } : { isLoading: false };
  },
}));

import { CREATOR_LAUNCHES_LIMIT, useCreatorLaunches } from "@/hooks/useLaunchActivity";

beforeEach(() => {
  reads.length = 0;
  for (const k of Object.keys(byCreator)) delete byCreator[k];
});

const enabledReads = () => reads.filter((r) => r.enabled);

describe("useCreatorLaunches", () => {
  it("asks the backend's creator filter for the connected wallet", () => {
    byCreator[WALLET] = [{ token: A }];
    const { result } = renderHook(() => useCreatorLaunches(WALLET));
    expect(enabledReads().map((r) => [r.path, r.params])).toEqual([
      ["/launchpad/tokens", { creator: WALLET, limit: CREATOR_LAUNCHES_LIMIT }],
    ]);
    expect(result.current.launches.map((l) => l.token)).toEqual([A]);
  });

  it("lower-cases a checksummed address", () => {
    renderHook(() => useCreatorLaunches(CHECKSUMMED));
    expect(enabledReads().map((r) => r.params.creator)).toEqual([CHECKSUMMED.toLowerCase()]);
  });

  it("reads nothing with nobody connected", () => {
    const { result } = renderHook(() => useCreatorLaunches(undefined));
    expect(enabledReads()).toHaveLength(0);
    expect(result.current.launches).toEqual([]);
  });
});
