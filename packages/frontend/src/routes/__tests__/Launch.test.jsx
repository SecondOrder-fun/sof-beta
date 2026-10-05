import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

import Launch from "@/routes/Launch";
import {
  useLaunchpadConfig,
  useLaunchpadReady,
  useLaunchToken,
  useTradeFeeBounds,
} from "@/hooks/useTokenLaunchpad";

vi.mock("@/hooks/useTokenLaunchpad", async () => {
  const actual = await vi.importActual("@/hooks/useTokenLaunchpad");
  return {
    ...actual,
    useLaunchpadConfig: vi.fn(),
    useLaunchpadReady: vi.fn(),
    useLaunchToken: vi.fn(),
    useTradeFeeBounds: vi.fn(),
  };
});

// Partial mock: importActual on useTokenLaunchpad above pulls in
// useSmartTransactions -> wagmiConfig, which needs wagmi's real createConfig.
const balance = { current: undefined };
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal()),
  useAccount: () => ({ isConnected: true, address: "0x9999999999999999999999999999999999999999" }),
  useBalance: () => ({ data: balance.current }),
}));
const routerState = { router: "0x7777777777777777777777777777777777777777", isLoading: false };
vi.mock("@/hooks/useLaunchTrade", () => ({ useLaunchRouter: () => routerState }));
vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, opts) =>
      key === "summary.tradeFeeValue" || key === "form.tradeFeePercent" || key.startsWith("errors.tradeFee")
        ? `${key}(${Object.entries(opts ?? {}).map(([k, v]) => `${k}=${v}`).join(",")})`
        : opts?.unit
          ? `${key}:${opts.unit}`
          : key,
  }),
}));

// Radix Select needs these in jsdom.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

const ONE_ETH = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const CONFIG = {
  totalSupply: 1_000_000_000n * ONE_ETH,
  wholeSupply: 1_000_000_000n,
  quotes: [
    { address: ZERO, symbol: "ETH", decimals: 18, minFdv: ONE_ETH, maxFdv: 1000n * ONE_ETH },
    { address: USDC, symbol: "USDC", decimals: 6, minFdv: 2_500n * 10n ** 6n, maxFdv: 2_500_000n * 10n ** 6n },
  ],
};

let launchMock;

const setup = ({ config = CONFIG, isAvailable = true, ready = true, feeBounds = { min: 5_000, max: 100_000 } } = {}) => {
  launchMock = vi.fn().mockResolvedValue("0xhash");
  balance.current = undefined;
  useLaunchpadConfig.mockReturnValue({
    data: config,
    isLoading: false,
    isAvailable,
  });
  useLaunchpadReady.mockReturnValue({ data: ready });
  useTradeFeeBounds.mockReturnValue({ data: feeBounds });
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

const fill = ({ name = "Second Order", symbol = "SOF", fdv = "1", firstBuy } = {}) => {
  fireEvent.change(screen.getByLabelText("form.name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("form.symbol"), { target: { value: symbol } });
  fireEvent.change(screen.getByLabelText("form.valuation"), { target: { value: fdv } });
  if (firstBuy != null) fireEvent.change(screen.getByLabelText("form.firstBuy"), { target: { value: firstBuy } });
};

const pickQuote = (symbol) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "form.pairedWith" }), { key: "Enter" });
  fireEvent.click(within(screen.getByRole("listbox")).getByText(symbol));
};

const submit = async () => {
  // act: submit is async and sets state after awaiting the launch.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
  });
};

describe("Launch form", () => {
  beforeEach(() => vi.clearAllMocks());

  // The design of the page: the creator enters a valuation, and the per-token
  // price — nine orders of magnitude away — is derived and shown, never typed.
  it("derives the per-token price from the entered valuation", () => {
    setup();
    fill({ fdv: "1" });
    expect(screen.getByText("1 summary.startPriceUnit:gwei")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("form.valuation"), { target: { value: "1000" } });
    expect(screen.getByText("1000 summary.startPriceUnit:gwei")).toBeInTheDocument();
  });

  it("submits the valuation itself as startFdv, paired with ETH by default", async () => {
    setup();
    fill({ fdv: "2" });
    await submit();

    expect(launchMock).toHaveBeenCalledWith({
      name: "Second Order",
      symbol: "SOF",
      metadataURI: "",
      quoteToken: ZERO,
      startFdv: 2n * ONE_ETH,
      tradeFee: 10_000,
      creatorBuyIn: 0n,
    });
  });

  describe("trade fee", () => {
    const tradeFeeInput = () => screen.getByLabelText("form.tradeFee");
    const preset = (pct) => screen.getByRole("button", { name: `form.tradeFeePercent(fee=${pct})` });

    it("defaults to 1%, and says so in the summary: paid in the quote, 88% to the creator", () => {
      setup();
      expect(tradeFeeInput()).toHaveValue("1");
      expect(preset("1")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("summary.tradeFeeValue(fee=1,quote=ETH,share=88)")).toBeInTheDocument();
    });

    it("offers 0.5%, 1%, 2% and 5%, and submits the chosen one in pips", async () => {
      setup();
      for (const pct of ["0.5", "1", "2", "5"]) expect(preset(pct)).toBeInTheDocument();
      fireEvent.click(preset("5"));
      expect(tradeFeeInput()).toHaveValue("5");
      fill({ fdv: "2" });
      await submit();
      expect(launchMock.mock.calls[0][0]).toMatchObject({ tradeFee: 50_000 });
    });

    it("takes a custom percentage", async () => {
      setup();
      fireEvent.change(tradeFeeInput(), { target: { value: "2.5" } });
      expect(screen.getByText("summary.tradeFeeValue(fee=2.5,quote=ETH,share=88)")).toBeInTheDocument();
      fill({ fdv: "2" });
      await submit();
      expect(launchMock.mock.calls[0][0]).toMatchObject({ tradeFee: 25_000 });
    });

    it("names the quote it is paid in", () => {
      setup();
      pickQuote("USDC");
      expect(screen.getByText("summary.tradeFeeValue(fee=1,quote=USDC,share=88)")).toBeInTheDocument();
    });

    it("refuses a fee below the placer's minimum", async () => {
      setup({ feeBounds: { min: 5_000, max: 100_000 } });
      fireEvent.change(tradeFeeInput(), { target: { value: "0.25" } });
      fill({ fdv: "2" });
      fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
      expect(await screen.findByText("errors.tradeFeeTooLow(min=0.5,max=10)")).toBeInTheDocument();
      expect(launchMock).not.toHaveBeenCalled();
    });

    it("refuses a fee above 10%", async () => {
      setup();
      fireEvent.change(tradeFeeInput(), { target: { value: "12" } });
      fill({ fdv: "2" });
      fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
      expect(await screen.findByText("errors.tradeFeeTooHigh(min=0.5,max=10)")).toBeInTheDocument();
      expect(launchMock).not.toHaveBeenCalled();
    });

    it("refuses an empty or unreadable fee", async () => {
      setup();
      fireEvent.change(tradeFeeInput(), { target: { value: "" } });
      fill({ fdv: "2" });
      fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
      expect(await screen.findByText("errors.tradeFeeInvalid(min=0.5,max=10)")).toBeInTheDocument();
      expect(launchMock).not.toHaveBeenCalled();
    });
  });

  it("submits an optional first buy in the launch transaction", async () => {
    setup();
    fill({ fdv: "2", firstBuy: "0.1" });
    expect(screen.getByText("0.1 ETH")).toBeInTheDocument(); // the summary row
    await submit();
    expect(launchMock.mock.calls[0][0]).toMatchObject({ quoteToken: ZERO, creatorBuyIn: ONE_ETH / 10n });
  });

  // USDC: the valuation is typed in USDC, checked against USDC's own bounds,
  // and sent in its 6-decimal raw units; the price reads in USDC.
  it("pairs with USDC: valuation and first buy in USDC, against USDC's bounds", async () => {
    setup();
    pickQuote("USDC");
    fill({ fdv: "5000", firstBuy: "25" });
    expect(screen.getByText("5,000 USDC")).toBeInTheDocument();
    expect(screen.getByText("0.000005 summary.startPriceUnit:USDC")).toBeInTheDocument();
    await submit();
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteToken: USDC, startFdv: 5_000_000_000n, creatorBuyIn: 25_000_000n }),
    );
  });

  it("refuses a USDC valuation below USDC's floor, though it would clear ETH's", async () => {
    setup();
    pickQuote("USDC");
    fill({ fdv: "2000" });
    fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
    expect(await screen.findByText("errors.fdvTooLow")).toBeInTheDocument();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("offers only the quotes the launchpad allows", () => {
    setup({ config: { ...CONFIG, quotes: CONFIG.quotes.slice(0, 1) } });
    // One allowed quote: nothing to choose, so the select is disabled.
    expect(screen.getByRole("combobox", { name: "form.pairedWith" })).toBeDisabled();
  });

  it("refuses a first buy the creator cannot pay for", async () => {
    setup();
    fill({ fdv: "2", firstBuy: "1" });
    balance.current = { value: ONE_ETH / 2n };
    fireEvent.change(screen.getByLabelText("form.firstBuy"), { target: { value: "1.0" } });
    fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
    expect(await screen.findByText("errors.firstBuyBalance")).toBeInTheDocument();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("refuses a first buy while in-app trading is off", async () => {
    routerState.router = null;
    try {
      setup();
      fill({ fdv: "2", firstBuy: "0.1" });
      fireEvent.click(screen.getByRole("button", { name: "form.submit" }));
      expect(await screen.findByText("errors.firstBuyNoRouter")).toBeInTheDocument();
      expect(launchMock).not.toHaveBeenCalled();
    } finally {
      routerState.router = "0x7777777777777777777777777777777777777777";
    }
  });

  it("states the liquidity honestly: locked, at every price", () => {
    setup();
    expect(screen.getByText("summary.liquidityValue")).toBeInTheDocument();
    expect(screen.getByText("summary.firstBuyNone")).toBeInTheDocument();
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
