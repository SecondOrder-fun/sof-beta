import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import BuyPanel from "@/components/launchpad/BuyPanel";
import { deriveMarketState } from "@/lib/v4PoolMath";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts?.symbol ? `${key}:${opts.symbol}` : key) }),
}));
const account = { address: "0x9999999999999999999999999999999999999999", isConnected: true };
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal()),
  useBalance: () => ({ data: { value: 2n * 10n ** 18n } }),
  useAccount: () => account,
}));
const tradeState = { router: "0x7777777777777777777777777777777777777777", error: null, isPending: false };
const tradeMock = vi.fn();
vi.mock("@/hooks/useLaunchTrade", () => ({
  useLaunchTrade: () => ({
    trade: tradeMock,
    reset: vi.fn(),
    isPending: tradeState.isPending,
    error: tradeState.error,
    router: tradeState.router,
    canTrade: Boolean(tradeState.router),
  }),
}));
const openLoginModal = vi.fn();
vi.mock("@/hooks/useLoginModal", () => ({ useLoginModal: () => ({ openLoginModal }) }));
const tokenBalance = { current: 0n };
vi.mock("@/hooks/useQuoteBalance", () => ({
  useQuoteBalance: () => ({ balance: tokenBalance.current }),
}));

// The launch state from test_fixture_quoteMathForFrontend: a real PoolManager,
// 1 ETH FDV, untouched. A 0.1 ETH buy from here delivered exactly
// 90,544,562.424768864432372374 tokens on-chain.
const TOKEN = "0x1111111111111111111111111111111111111111";
const market = deriveMarketState({
  slot0Word: "0x0000000027100000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  liquidityWord: "0x0", // v4 reports 0 active at launch — the panel must still quote
  placement: { tickLower: 161200, tickUpper: 207200, liquidity: 35222655548218972599314n },
  wholeSupply: 1_000_000_000n,
});

const setup = (props = {}) =>
  render(<BuyPanel token={TOKEN} symbol="POND" market={market} {...props} />);

const typeAmount = (v) => fireEvent.change(screen.getByLabelText("trade.youPay"), { target: { value: v } });

describe("BuyPanel", () => {
  beforeEach(() => {
    tokenBalance.current = 0n;
    account.isConnected = true;
    tradeState.router = "0x7777777777777777777777777777777777777777";
    tradeState.error = null;
    tradeState.isPending = false;
    tradeMock.mockReset().mockResolvedValue("0xhash");
    openLoginModal.mockReset();
  });

  it("quotes a buy at launch exactly as the real v4 swap filled it", () => {
    setup();
    typeAmount("0.1");
    // 90,544,562.42… tokens -> "90.54M"
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("90.54M");
  });

  it("shows price impact, and flags it once it is large", () => {
    setup();
    typeAmount("0.01");
    const small = parseFloat(screen.getByTestId("trade-impact").textContent);
    expect(small).toBeGreaterThan(0);
    expect(screen.getByTestId("trade-impact")).not.toHaveClass("text-destructive");

    typeAmount("0.5");
    expect(parseFloat(screen.getByTestId("trade-impact").textContent)).toBeGreaterThan(small);
    expect(screen.getByTestId("trade-impact")).toHaveClass("text-destructive");
  });

  it("fills the amount from a quick-amount button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "0.1" }));
    expect(screen.getByLabelText("trade.youPay")).toHaveValue("0.1");
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("90.54M");
  });

  it("warns when a buy is larger than the supply left in the pool", () => {
    setup();
    typeAmount("500");
    expect(screen.getByText("trade.exceedsBuy")).toBeInTheDocument();
  });

  it("switches to selling, and clears the amount so a buy size is not reused as tokens", () => {
    setup();
    typeAmount("0.1");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "trade.sell" }));
    fireEvent.click(screen.getByRole("tab", { name: "trade.sell" }));
    expect(screen.getByLabelText("trade.youPay")).toHaveValue("");
    expect(screen.getByText("POND")).toBeInTheDocument(); // paying in the token now
  });

  it("offers percentage-of-balance presets when selling", () => {
    tokenBalance.current = 1000n * 10n ** 18n;
    setup();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "trade.sell" }));
    fireEvent.click(screen.getByRole("tab", { name: "trade.sell" }));
    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    expect(screen.getByLabelText("trade.youPay")).toHaveValue("500");
  });

  // The button sends exactly the quoted trade: amount in, and a minimum out equal to
  // the quote less the slippage setting (default 1%).
  it("buys through the router with the quote as the minimum, less slippage", async () => {
    setup();
    typeAmount("0.1");
    fireEvent.click(screen.getByRole("button", { name: "trade.buyCta:POND" }));
    await vi.waitFor(() => expect(tradeMock).toHaveBeenCalled());
    const quoted = 90544562424768864432372374n;
    expect(tradeMock).toHaveBeenCalledWith({
      side: "buy",
      token: TOKEN,
      amountIn: 10n ** 17n,
      minOut: (quoted * 9900n) / 10000n,
    });
  });

  // At a fresh launch there is nothing to sell into — the price is at the top of the
  // range. Sell against the pool as it stood after the fixture's first buy.
  it("sells the typed token amount", async () => {
    tokenBalance.current = 1_000_000n * 10n ** 18n;
    setup({ market: { ...market, sqrtPriceX96: 2296364796274511973167666432089657n } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "trade.sell" }));
    fireEvent.click(screen.getByRole("tab", { name: "trade.sell" }));
    typeAmount("1000");
    fireEvent.click(screen.getByRole("button", { name: "trade.sellCta:POND" }));
    await vi.waitFor(() => expect(tradeMock).toHaveBeenCalled());
    expect(tradeMock.mock.calls[0][0]).toMatchObject({ side: "sell", amountIn: 1000n * 10n ** 18n });
  });

  it("will not submit more than the balance", () => {
    setup();
    typeAmount("5"); // balance is 2 ETH
    expect(screen.getByRole("button", { name: "trade.insufficient" })).toBeDisabled();
  });

  it("asks a disconnected user to connect instead", () => {
    account.isConnected = false;
    setup();
    typeAmount("0.1");
    fireEvent.click(screen.getByRole("button", { name: "trade.connect" }));
    expect(openLoginModal).toHaveBeenCalled();
    expect(tradeMock).not.toHaveBeenCalled();
  });

  // setRouter(0) is the switch that turns in-app trading off. Quotes still work.
  it("disables trading and says so when no router is set", () => {
    tradeState.router = null;
    setup();
    typeAmount("0.1");
    expect(screen.getByRole("button", { name: "trade.buyCta:POND" })).toBeDisabled();
    expect(screen.getByText("trade.routerOff")).toBeInTheDocument();
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("90.54M");
  });

  it("shows a failed trade's reason", () => {
    tradeState.error = { shortMessage: "InsufficientOutput" };
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent("InsufficientOutput");
  });

  it("asks for an amount before anything else", () => {
    setup();
    expect(screen.getByRole("button", { name: "trade.enterAmount" })).toBeDisabled();
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("0");
  });

  it("ignores input that is not a number", () => {
    setup();
    typeAmount("abc");
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("0");
  });
});
