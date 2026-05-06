// tests/components/SweepBanner.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import * as raffleAccountHook from "@/hooks/useRaffleAccount";
import SweepBanner from "@/components/auth/SweepBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

const writeContractMock = vi.fn();
const useReadContractMock = vi.fn();
const useWriteContractMock = vi.fn();
const useWaitForTransactionReceiptMock = vi.fn();

vi.mock("wagmi", () => ({
  useReadContract: (...args) => useReadContractMock(...args),
  useWriteContract: (...args) => useWriteContractMock(...args),
  useWaitForTransactionReceipt: (...args) =>
    useWaitForTransactionReceiptMock(...args),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    SOF: "0x2222222222222222222222222222222222222222",
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
}));

vi.mock("@/utils/abis", () => ({
  ERC20Abi: [],
}));

const EOA = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const SMA = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";

const setReadyDesktopAccount = () =>
  vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
    eoa: EOA,
    sma: SMA,
    walletType: "desktop-eoa",
    isReady: true,
  });

describe("SweepBanner", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    writeContractMock.mockReset();
    useReadContractMock.mockReset();
    useWriteContractMock.mockReset();
    useWaitForTransactionReceiptMock.mockReset();

    useWriteContractMock.mockReturnValue({
      writeContract: writeContractMock,
      data: undefined,
      isPending: false,
    });
    useWaitForTransactionReceiptMock.mockReturnValue({ isLoading: false });
  });

  it("renders when EOA balance > 0 for desktop-EOA wallets", () => {
    setReadyDesktopAccount();
    useReadContractMock.mockReturnValue({ data: 5_000000000000000000n });

    render(<SweepBanner />);

    expect(screen.getByTestId("sweep-banner")).toBeInTheDocument();
    expect(screen.getByText(/sweep\.title/)).toBeInTheDocument();
    // Body should interpolate the formatted amount.
    expect(
      screen.getByText((content) => content.startsWith("sweep.body|") && content.includes("\"amount\":\"5\"")),
    ).toBeInTheDocument();
  });

  it("does not render when EOA balance is zero", () => {
    setReadyDesktopAccount();
    useReadContractMock.mockReturnValue({ data: 0n });

    render(<SweepBanner />);

    expect(screen.queryByTestId("sweep-banner")).not.toBeInTheDocument();
  });

  it("does not render for non-desktop-EOA wallets", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      eoa: EOA,
      sma: EOA,
      walletType: "coinbase-smart",
      isReady: true,
    });
    useReadContractMock.mockReturnValue({ data: 5_000000000000000000n });

    render(<SweepBanner />);

    expect(screen.queryByTestId("sweep-banner")).not.toBeInTheDocument();
  });

  it("does not render when balance read returns undefined (not yet loaded)", () => {
    setReadyDesktopAccount();
    useReadContractMock.mockReturnValue({ data: undefined });

    render(<SweepBanner />);

    expect(screen.queryByTestId("sweep-banner")).not.toBeInTheDocument();
  });

  it("clicking sweep calls writeContract with transfer(sma, balance)", () => {
    setReadyDesktopAccount();
    useReadContractMock.mockReturnValue({ data: 7n });

    render(<SweepBanner />);

    fireEvent.click(screen.getByRole("button", { name: /sweep\.confirmBtn/ }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    const call = writeContractMock.mock.calls[0][0];
    expect(call.functionName).toBe("transfer");
    expect(call.args).toEqual([SMA, 7n]);
    expect(call.address).toBe("0x2222222222222222222222222222222222222222");
  });
});
