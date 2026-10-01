/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const SMA = "0x5555555555555555555555555555555555555555";
const EOA = "0x6666666666666666666666666666666666666666";
const A = "0xAAAA00000000000000000000000000000000aaaa";
const B = "0xbbbb00000000000000000000000000000000bbbb";

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
  it("asks the backend's creator filter for both accounts of a desktop wallet", () => {
    byCreator[SMA.toLowerCase()] = [{ token: A }];
    byCreator[EOA.toLowerCase()] = [{ token: B }];
    const { result } = renderHook(() => useCreatorLaunches({ eoa: EOA, sma: SMA }));
    expect(enabledReads().map((r) => [r.path, r.params])).toEqual([
      ["/launchpad/tokens", { creator: SMA.toLowerCase(), limit: CREATOR_LAUNCHES_LIMIT }],
      ["/launchpad/tokens", { creator: EOA.toLowerCase(), limit: CREATOR_LAUNCHES_LIMIT }],
    ]);
    expect(result.current.launches.map((l) => l.token)).toEqual([A, B]);
  });

  it("asks once when the connected address is the smart account", () => {
    renderHook(() => useCreatorLaunches({ eoa: SMA, sma: SMA.toLowerCase() }));
    expect(enabledReads()).toHaveLength(1);
  });

  it("lists a launch once even if both reads return it", () => {
    byCreator[SMA.toLowerCase()] = [{ token: A }];
    byCreator[EOA.toLowerCase()] = [{ token: A.toLowerCase() }];
    const { result } = renderHook(() => useCreatorLaunches({ eoa: EOA, sma: SMA }));
    expect(result.current.launches).toHaveLength(1);
  });

  it("reads nothing with nobody connected", () => {
    const { result } = renderHook(() => useCreatorLaunches({}));
    expect(enabledReads()).toHaveLength(0);
    expect(result.current.launches).toEqual([]);
  });
});
