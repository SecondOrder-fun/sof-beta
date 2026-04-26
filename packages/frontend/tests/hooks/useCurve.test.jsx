// tests/hooks/useCurve.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";
import { decodeFunctionData } from "viem";

const executeBatch = vi.fn();
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
  getChainConfig: () => ({ chain: { id: 31337 }, transport: {} }),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    SOF: "0x0000000000000000000000000000000000000aAa",
  }),
}));

import { useCurve } from "@/hooks/useCurve";
import { SOFBondingCurveAbi, ERC20Abi } from "@/utils/abis";

function createWrapper() {
  const client = new QueryClient();
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  Wrapper.propTypes = { children: PropTypes.node };
  Wrapper.displayName = "UseCurveTestWrapper";
  return Wrapper;
}

describe("useCurve", () => {
  beforeEach(() => {
    executeBatch.mockReset();
  });

  it("approve routes through executeBatch with ERC20 approve(curveAddr, amount)", async () => {
    executeBatch.mockResolvedValueOnce("0xapprove");
    const { result } = renderHook(() => useCurve("0xcccccccccccccccccccccccccccccccccccccccc"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.approve.mutateAsync({ amount: 123n });
    });

    expect(executeBatch).toHaveBeenCalledTimes(1);
    const [calls, opts] = executeBatch.mock.calls[0];
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("0x0000000000000000000000000000000000000aAa");
    const decoded = decodeFunctionData({ abi: ERC20Abi, data: calls[0].data });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args[0].toLowerCase()).toBe(
      "0xcccccccccccccccccccccccccccccccccccccccc",
    );
    expect(decoded.args[1]).toBe(123n);
    expect(opts).toEqual({ sofAmount: 0n });
  });

  it("buyTokens routes through executeBatch with curve.buyTokens(amount, maxSof)", async () => {
    executeBatch.mockResolvedValueOnce("0xbuy");
    const { result } = renderHook(() => useCurve("0xcccccccccccccccccccccccccccccccccccccccc"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.buyTokens.mutateAsync({
        tokenAmount: 10n,
        maxSofAmount: 100n,
      });
    });

    const [calls, opts] = executeBatch.mock.calls[0];
    expect(calls[0].to).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    const decoded = decodeFunctionData({
      abi: SOFBondingCurveAbi,
      data: calls[0].data,
    });
    expect(decoded.functionName).toBe("buyTokens");
    expect(decoded.args).toEqual([10n, 100n]);
    expect(opts).toEqual({ sofAmount: 100n });
  });

  it("sellTokens routes through executeBatch with curve.sellTokens(amount, minSof)", async () => {
    executeBatch.mockResolvedValueOnce("0xsell");
    const { result } = renderHook(() => useCurve("0xcccccccccccccccccccccccccccccccccccccccc"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.sellTokens.mutateAsync({
        tokenAmount: 5n,
        minSofAmount: 50n,
      });
    });

    const [calls, opts] = executeBatch.mock.calls[0];
    expect(calls[0].to).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    const decoded = decodeFunctionData({
      abi: SOFBondingCurveAbi,
      data: calls[0].data,
    });
    expect(decoded.functionName).toBe("sellTokens");
    expect(decoded.args).toEqual([5n, 50n]);
    expect(opts).toEqual({ sofAmount: 0n });
  });
});
