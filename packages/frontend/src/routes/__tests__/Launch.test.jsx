import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import Launch from "@/routes/Launch";
import {
  useLaunchpadConfig,
  useLaunchpadReady,
  useLaunchToken,
} from "@/hooks/useTokenLaunchpad";

vi.mock("@/hooks/useTokenLaunchpad", async () => {
  const actual = await vi.importActual("@/hooks/useTokenLaunchpad");
  return {
    ...actual,
    useLaunchpadConfig: vi.fn(),
    useLaunchpadReady: vi.fn(),
    useLaunchToken: vi.fn(),
  };
});

// Partial mock: importActual on useTokenLaunchpad above pulls in
// useSmartTransactions -> wagmiConfig, which needs wagmi's real createConfig.
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal()),
  useAccount: () => ({ isConnected: true }),
}));
vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

const ONE_ETH = 10n ** 18n;

const CONFIG = {
  totalSupply: 1_000_000_000n * ONE_ETH,
  wholeSupply: 1_000_000_000n,
  minStartPriceWei: 1_000_000_000n,
  maxStartPriceWei: 1_000_000_000_000n,
  minFdvWei: ONE_ETH,
  maxFdvWei: 1000n * ONE_ETH,
};

let launchMock;

const setup = ({ config = CONFIG, isAvailable = true, ready = true } = {}) => {
  launchMock = vi.fn().mockResolvedValue("0xhash");
  useLaunchpadConfig.mockReturnValue({
    data: config,
    isLoading: false,
    isAvailable,
  });
  useLaunchpadReady.mockReturnValue({ data: ready });
  useLaunchToken.mockReturnValue({
    launch: launchMock,
    isPending: false,
    isSuccess: false,
    error: "",
    reset: vi.fn(),
  });

  return render(
    <MemoryRouter>
      <Launch />
    </MemoryRouter>,
  );
};

const fill = ({ name = "Second Order", symbol = "SOF", fdv = "1" } = {}) => {
  fireEvent.change(screen.getByLabelText("form.name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("form.symbol"), { target: { value: symbol } });
  fireEvent.change(screen.getByLabelText("form.valuation"), { target: { value: fdv } });
};

describe("Launch form", () => {
  beforeEach(() => vi.clearAllMocks());

  // The design of the page: the creator enters a valuation, and the per-token
  // price — nine orders of magnitude away — is derived and shown, never typed.
  it("derives the per-token price from the entered valuation", () => {
    setup();
    fill({ fdv: "1" });
    expect(screen.getByText("1 summary.startPriceUnit")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("form.valuation"), { target: { value: "1000" } });
    expect(screen.getByText("1000 summary.startPriceUnit")).toBeInTheDocument();
  });

  it("submits the derived start price, not the valuation", async () => {
    setup();
    fill({ fdv: "2" });
    // act: submit is async and sets state after awaiting the launch.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
    });

    expect(launchMock).toHaveBeenCalled();
    expect(launchMock).toHaveBeenCalledWith({
      name: "Second Order",
      symbol: "SOF",
      metadataURI: "",
      // 2 ETH / 1e9 tokens = 2 gwei per token
      startPriceWei: 2_000_000_000n,
    });
  });

  it("refuses a valuation below the floor without asking for a signature", async () => {
    setup();
    fill({ fdv: "0.5" });
    fireEvent.click(screen.getByRole("button", { name: "form.submit" }));

    expect(await screen.findByText("errors.fdvTooLow")).toBeInTheDocument();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("refuses a valuation above the ceiling", async () => {
    setup();
    fill({ fdv: "1001" });
    fireEvent.click(screen.getByRole("button", { name: "form.submit" }));

    expect(await screen.findByText("errors.fdvTooHigh")).toBeInTheDocument();
    expect(launchMock).not.toHaveBeenCalled();
  });

  // Errors appear on submit, not while typing — a half-typed name should not
  // be accused of being empty.
  it("stays quiet until the form is submitted", () => {
    setup();
    expect(screen.queryByText("errors.nameRequired")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
    expect(screen.getByText("errors.nameRequired")).toBeInTheDocument();
  });

  it("disables launching when no liquidity placer is configured", () => {
    setup({ ready: false });

    expect(screen.getByText("unavailable.notReadyTitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "form.submit" })).toBeDisabled();
  });

  it("renders an explanation instead of a form when the network has no launchpad", () => {
    setup({ isAvailable: false });

    expect(screen.getByText("unavailable.title")).toBeInTheDocument();
    expect(screen.queryByLabelText("form.name")).not.toBeInTheDocument();
  });
});
