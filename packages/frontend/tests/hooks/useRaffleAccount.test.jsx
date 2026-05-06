import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { RaffleAccountProvider } from "@/context/RaffleAccountProvider";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import * as wagmi from "wagmi";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(() => 31337),
  useReadContract: vi.fn(),
  useConnectorClient: vi.fn(() => ({ data: null })),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF_SMART_ACCOUNT_FACTORY: "0xFACT" }),
}));

describe("useRaffleAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns desktop-eoa walletType for injected MetaMask, with SMA from factory", async () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xEOA",
      connector: { id: "injected", name: "MetaMask" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({
      data: "0xSMA",
      isPending: false,
      isError: false,
    });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.eoa).toBe("0xEOA");
    expect(result.current.sma).toBe("0xSMA");
    expect(result.current.walletType).toBe("desktop-eoa");
  });

  it("returns coinbase-smart for coinbaseWalletSDK with eoa==sma", async () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xCBW",
      connector: { id: "coinbaseWalletSDK" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({ data: undefined, isPending: false, isError: false });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.walletType).toBe("coinbase-smart");
    expect(result.current.eoa).toBe("0xCBW");
    expect(result.current.sma).toBe("0xCBW");
  });

  it("returns farcaster-miniapp for farcasterMiniApp connector", async () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xFC",
      connector: { id: "farcasterMiniApp", name: "Farcaster" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({ data: undefined, isPending: false, isError: false });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.walletType).toBe("farcaster-miniapp");
    expect(result.current.eoa).toBe("0xFC");
    expect(result.current.sma).toBe("0xFC");
  });

  it("returns isReady false while SMA query is pending", () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xEOA",
      connector: { id: "injected" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.sma).toBeUndefined();
  });
});
