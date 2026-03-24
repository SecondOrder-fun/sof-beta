// tests/hooks/useCurve.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

// Mock wagmi write hook
const writeContractAsync = vi.fn();
vi.mock("wagmi", () => ({
  useWriteContract: () => ({ writeContractAsync }),
}));

// Mock contracts helpers and ABIs
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    SOF: "0x0000000000000000000000000000000000000aAa",
  }),
}));
vi.mock("@/contracts/abis/SOFBondingCurve.json", () => ({
  default: ["buyTokens", "sellTokens"],
}));
vi.mock("@/contracts/abis/ERC20.json", () => ({
  default: { abi: [{ name: "approve" }] },
}));

import { useCurve } from "@/hooks/useCurve";

function createWrapper() {
  const client = new QueryClient();

  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  Wrapper.propTypes = {
    children: PropTypes.node,
  };

  Wrapper.displayName = "UseCurveTestWrapper";

  return Wrapper;
}

describe("useCurve", () => {
  beforeEach(() => {
    writeContractAsync.mockReset();
  });

  it("approve calls ERC20 approve with bonding curve address and amount", async () => {
    writeContractAsync.mockResolvedValueOnce("0xapprove");
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCurve("0xCurve..."), { wrapper });
    await act(async () => {
      await result.current.approve.mutateAsync({ amount: 123n });
    });
    expect(writeContractAsync).toHaveBeenCalled();
    const call = writeContractAsync.mock.calls[0][0];
    expect(call.address).toBe("0x0000000000000000000000000000000000000aAa");
    expect(call.functionName).toBe("approve");
    expect(call.args).toEqual(["0xCurve...", 123n]);
  });

  it("buyTokens calls curve buyTokens with args", async () => {
    writeContractAsync.mockResolvedValueOnce("0xbuy");
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCurve("0xCurve..."), { wrapper });
    await act(async () => {
      await result.current.buyTokens.mutateAsync({
        tokenAmount: 10n,
        maxSofAmount: 100n,
      });
    });
    const call = writeContractAsync.mock.calls[0][0];
    expect(call.functionName).toBe("buyTokens");
    expect(call.args).toEqual([10n, 100n]);
  });

  it("sellTokens calls curve sellTokens with args", async () => {
    writeContractAsync.mockResolvedValueOnce("0xsell");
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCurve("0xCurve..."), { wrapper });
    await act(async () => {
      await result.current.sellTokens.mutateAsync({
        tokenAmount: 5n,
        minSofAmount: 50n,
      });
    });
    const call = writeContractAsync.mock.calls[0][0];
    expect(call.functionName).toBe("sellTokens");
    expect(call.args).toEqual([5n, 50n]);
  });
});
