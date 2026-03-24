/*
  @vitest-environment jsdom
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "TESTNET",
}));

vi.mock("@/contracts/abis/SOFBondingCurve.json", () => ({
  default: {
    abi: [],
  },
}));

describe("useCurveState multicall fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("falls back to readContract when multicall is unavailable", async () => {
    const readContractMock = vi.fn(async ({ functionName }) => {
      if (functionName === "curveConfig") return [123n, 456n];
      if (functionName === "getCurrentStep")
        return [0n, 10_000000000000000000n, 10_000n];
      if (functionName === "getBondSteps") {
        return [
          { rangeTo: 10_000n, price: 10_000000000000000000n },
          { rangeTo: 20_000n, price: 11_000000000000000000n },
        ];
      }
      if (functionName === "accumulatedFees") return 0n;
      return 0n;
    });

    vi.doMock("@/lib/viemClient", () => ({
      buildPublicClient: () => ({
        multicall: undefined,
        readContract: readContractMock,
      }),
    }));

    const { useCurveState } = await import("@/hooks/useCurveState");

    const { result, unmount } = renderHook(() =>
      useCurveState("0x0000000000000000000000000000000000000001", {
        isActive: true,
        pollMs: 999999,
        includeSteps: true,
        includeFees: true,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(readContractMock).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "getBondSteps" }),
      );
    });

    expect(result.current.curveSupply).toBe(123n);
    expect(result.current.curveReserves).toBe(456n);
    expect(result.current.curveStep?.price).toBe(10_000000000000000000n);
    expect(result.current.allBondSteps).toHaveLength(2);

    unmount();
  });

  it("falls back to readContract when multicall throws", async () => {
    const readContractMock = vi.fn(async ({ functionName }) => {
      if (functionName === "curveConfig") return [1n, 2n];
      if (functionName === "getCurrentStep") return [1n, 12n, 100n];
      if (functionName === "getBondSteps") return [{ rangeTo: 1n, price: 2n }];
      if (functionName === "accumulatedFees") return 0n;
      return 0n;
    });

    const multicallMock = vi.fn(() => {
      throw new Error("multicall failed");
    });

    vi.doMock("@/lib/viemClient", () => ({
      buildPublicClient: () => ({
        multicall: multicallMock,
        readContract: readContractMock,
      }),
    }));

    const { useCurveState } = await import("@/hooks/useCurveState");

    const { result, unmount } = renderHook(() =>
      useCurveState("0x0000000000000000000000000000000000000002", {
        isActive: true,
        pollMs: 999999,
        includeSteps: true,
        includeFees: true,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(readContractMock).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "curveConfig" }),
      );
    });

    expect(multicallMock).toHaveBeenCalledTimes(1);

    expect(result.current.curveSupply).toBe(1n);
    expect(result.current.curveReserves).toBe(2n);
    expect(result.current.allBondSteps).toHaveLength(1);

    unmount();
  });
});
