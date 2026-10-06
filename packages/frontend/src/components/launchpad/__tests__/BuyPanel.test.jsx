import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import BuyPanel from "@/components/launchpad/BuyPanel";
import { buyFeeAt, deriveMarketState, minimumReceived, quoteBuy } from "@/lib/v4PoolMath";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, opts) =>
      key === "trade.tradeFeeValue"
        ? `${opts.amount} ${opts.quote} (${opts.fee}%)`
        : key === "trade.snipeTax"
          ? `Launch snipe tax: ${opts.rate}% now, falling to ${opts.fee}% in ${opts.time}`
          : key === "trade.snipeSeconds"
            ? `${opts.seconds} s`
            : key === "trade.snipeMinutes"
              ? `${opts.minutes} min ${opts.seconds} s`
              : opts?.symbol
          ? `${key}:${opts.symbol}`
          : key,
  }),
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
const usdcBalance = { current: 0n };
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
vi.mock("@/hooks/useQuoteBalance", () => ({
  useQuoteBalance: (address) => ({ balance: address === USDC ? usdcBalance.current : tokenBalance.current }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
// The chain's clock (the backend's latest block time); null = not read yet.
const chainAnchor = { current: null };
vi.mock("@/hooks/useChainTime", () => ({ useChainTimeAnchor: () => chainAnchor.current }));

// The launch state from test_fixture_quoteMathForFrontend: a real PoolManager,
// 1 ETH FDV at a 1% trade fee, untouched. A 0.1 ETH buy from here delivered
// exactly 89,729,910.215527505885256588 tokens on-chain, the fee 0.001 ETH.
const TOKEN = "0x1111111111111111111111111111111111111111";
const ETH = { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18 };
const fixture = {
  slot0Word: "0x0000000000000000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  liquidityWord: "0x0", // v4 reports 0 active at launch — the panel must still quote
  placement: {
    tickLower: -887200,
    tickUpper: 207200,
    liquidity: 31690866724818211737594n,
    tradeFee: 10_000,
    key: { tickSpacing: 200 },
  },
  wholeSupply: 1_000_000_000n,
};
const market = deriveMarketState({ ...fixture, quote: ETH });
// The same pool, but paired with USDC (6 decimals) as currency0.
const usdcMarket = deriveMarketState({ ...fixture, quote: { address: USDC, symbol: "USDC", decimals: 6 } });

const setup = (props = {}) =>
  render(<BuyPanel token={TOKEN} symbol="POND" market={market} {...props} />);

const typeAmount = (v) => fireEvent.change(screen.getByLabelText("trade.youPay"), { target: { value: v } });

describe("BuyPanel", () => {
  beforeEach(() => {
    tokenBalance.current = 0n;
    usdcBalance.current = 0n;
    account.isConnected = true;
    tradeState.router = "0x7777777777777777777777777777777777777777";
    tradeState.error = null;
    tradeState.isPending = false;
    tradeMock.mockReset().mockResolvedValue("0xhash");
    openLoginModal.mockReset();
    chainAnchor.current = null;
  });

  it("quotes a buy at launch exactly as the real v4 swap filled it", () => {
    setup();
    typeAmount("0.1");
    // 89,729,910.21… tokens -> "89.72M"
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("89.72M");
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
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("89.72M");
  });

  // The range runs to the end of v4's price scale, so an ordinary pool never
  // runs out; only a price already at the far edge can, and then it says so.
  it("does not warn on a large buy, since the pool never sells out", () => {
    setup();
    typeAmount("500");
    expect(screen.queryByText("trade.exceedsBuy")).not.toBeInTheDocument();
  });

  // The hook prices its fee on the whole payment, so a buy the range cannot fill
  // in full reverts on-chain (PartialFillWithFee): no quote, and no button.
  it("refuses a buy that would run past the far end of the range", () => {
    setup({ market: { ...market, sqrtPriceX96: market.sqrtLowerX96 * 2n } });
    typeAmount("1000000000000000000000000000");
    expect(screen.getByText("trade.exceedsBuy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trade.tooLarge" })).toBeDisabled();
  });

  it("shows the trade fee in the quote: 1% of a buy's payment", () => {
    setup();
    expect(screen.getByTestId("trade-fee")).toHaveTextContent("1%");
    typeAmount("0.1");
    expect(screen.getByTestId("trade-fee")).toHaveTextContent("0.001 ETH (1%)");
  });

  it("charges each launch its own rate", () => {
    setup({ market: { ...market, tradeFee: 25_000 } });
    typeAmount("0.1");
    expect(screen.getByTestId("trade-fee")).toHaveTextContent("0.0025 ETH (2.5%)");
  });

  it("shows a sell's fee in the quote, out of the proceeds", () => {
    tokenBalance.current = 1_000_000_000n * 10n ** 18n;
    // After the fixture's two buys; selling half the second returned 0.641819… ETH
    // net of a 0.006483… ETH fee.
    setup({ market: { ...market, sqrtPriceX96: 1199443894665599551439045032215605n } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "trade.sell" }));
    fireEvent.click(screen.getByRole("tab", { name: "trade.sell" }));
    typeAmount("215249280.768268422114373820");
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("0.641819");
    expect(screen.getByTestId("trade-fee")).toHaveTextContent("0.006483 ETH (1%)");
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
    const quoted = 89729910215527505885256588n;
    expect(tradeMock).toHaveBeenCalledWith({
      side: "buy",
      token: TOKEN,
      quoteToken: ETH.address,
      amountIn: 10n ** 17n,
      minOut: (quoted * 9900n) / 10000n,
    });
  });

  // A USDC-paired launch: amounts in USDC's 6 decimals, the USDC balance from
  // balanceOf, and the quote's address handed to the trade so it batches the
  // router's approval with the buy.
  it("buys a USDC-paired launch in USDC", async () => {
    usdcBalance.current = 500n * 10n ** 6n;
    setup({ market: usdcMarket });
    expect(screen.getByText("trade.balance")).toBeInTheDocument();
    expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "100" })); // a USDC preset
    fireEvent.click(screen.getByRole("button", { name: "trade.buyCta:POND" }));
    await vi.waitFor(() => expect(tradeMock).toHaveBeenCalled());
    expect(tradeMock.mock.calls[0][0]).toMatchObject({ side: "buy", quoteToken: USDC, amountIn: 100_000_000n });
  });

  it("checks a USDC buy against the USDC balance, not ETH", () => {
    usdcBalance.current = 50n * 10n ** 6n;
    setup({ market: usdcMarket });
    typeAmount("100");
    expect(screen.getByRole("button", { name: "trade.insufficient" })).toBeDisabled();
  });

  it("refuses more decimals than the quote has", () => {
    setup({ market: usdcMarket });
    typeAmount("1.0000001");
    expect(screen.getByRole("button", { name: "trade.enterAmount" })).toBeDisabled();
  });

  it("uses the launch record's quote while the pool has not been read", () => {
    setup({ market: undefined, quote: { address: USDC, symbol: "USDC", decimals: 6 } });
    expect(screen.getByRole("button", { name: "500" })).toBeInTheDocument();
    expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
  });

  // At a fresh launch there is nothing to sell into — the price is at the top of the
  // range. Sell against the pool as it stood after the fixture's first buy.
  it("sells the typed token amount", async () => {
    tokenBalance.current = 1_000_000n * 10n ** 18n;
    setup({ market: { ...market, sqrtPriceX96: 2275703824434668340440887773871330n } });
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
    expect(screen.getByTestId("trade-receive")).toHaveTextContent("89.72M");
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

  // A fresh launch on the deploy-default schedule (80% falling to the 1% trade fee
  // over 30 s), 10 s in by the chain's clock. The panel quotes 2 s behind the chain
  // (SNIPE_CLOCK_MARGIN_SEC), so at elapsed 8: 800_000 − floor(790_000·8/30) pips.
  describe("inside the launch's snipe-tax window", () => {
    const LAUNCHED = 1_700_000_000;
    const TAX = { startBps: 8_000, duration: 30, launchedAt: LAUNCHED };
    const snipeMarket = { ...market, snipeTax: TAX };
    const RATE = 589_334;
    const at = (chainSec) => {
      chainAnchor.current = { timestamp: chainSec, receivedAtMs: Date.now() };
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("warns with the live rate and how long until it is the trade fee", () => {
      at(LAUNCHED + 10);
      setup({ market: snipeMarket });
      expect(screen.getByTestId("snipe-tax")).toHaveTextContent(
        "Launch snipe tax: 58.94% now, falling to 1% in 22 s",
      );
      expect(screen.getByTestId("trade-fee")).toHaveTextContent("58.94%");
    });

    it("quotes the buy, its fee and its minimum at the window's rate", async () => {
      expect(buyFeeAt(10_000, TAX, LAUNCHED + 8)).toBe(RATE);
      at(LAUNCHED + 10);
      setup({ market: snipeMarket });
      typeAmount("0.1");
      const G = 10n ** 17n;
      // The hook's fee is ceil(G·r/1e6); the pool swaps the rest with no fee of its own.
      const fee = (G * BigInt(RATE) + 999_999n) / 1_000_000n;
      const direct = quoteBuy({
        sqrtPriceX96: market.sqrtPriceX96,
        liquidity: market.liquidity,
        sqrtLowerX96: market.sqrtLowerX96,
        sqrtUpperX96: market.sqrtUpperX96,
        tickSpacing: market.tickSpacing,
        tradeFee: 0,
        quoteIn: G - fee,
      });
      expect(screen.getByTestId("trade-fee")).toHaveTextContent("0.058933 ETH (58.94%)");
      fireEvent.click(screen.getByRole("button", { name: "trade.buyCta:POND" }));
      await vi.waitFor(() => expect(tradeMock).toHaveBeenCalled());
      expect(tradeMock.mock.calls[0][0]).toMatchObject({
        side: "buy",
        amountIn: G,
        minOut: minimumReceived(direct.tokensOut, "1"),
      });
      expect(direct.tokensOut).toBeLessThan(89729910215527505885256588n);
    });

    it("counts down each second and clears when the rate reaches the trade fee", () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      at(LAUNCHED + 10);
      setup({ market: snipeMarket });
      expect(screen.getByTestId("snipe-tax")).toHaveTextContent("in 22 s");

      act(() => vi.advanceTimersByTime(5_000));
      // elapsed 13: 800_000 − floor(790_000·13/30) = 457_667 pips
      expect(screen.getByTestId("snipe-tax")).toHaveTextContent("45.77% now, falling to 1% in 17 s");

      act(() => vi.advanceTimersByTime(17_000));
      expect(screen.queryByTestId("snipe-tax")).not.toBeInTheDocument();
      expect(screen.getByTestId("trade-fee")).toHaveTextContent("1%");
    });

    it("runs on the wall clock until the chain's time is read", () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime((LAUNCHED + 10) * 1000);
      setup({ market: snipeMarket });
      expect(screen.getByTestId("snipe-tax")).toHaveTextContent("58.94% now, falling to 1% in 22 s");
    });

    it("shows minutes for a long window", () => {
      at(LAUNCHED + 10);
      setup({ market: { ...market, snipeTax: { ...TAX, duration: 600 } } });
      // 600 − 8 = 592 s
      expect(screen.getByTestId("snipe-tax")).toHaveTextContent("in 9 min 52 s");
    });

    it("never taxes a sell", () => {
      tokenBalance.current = 1_000_000n * 10n ** 18n;
      at(LAUNCHED + 10);
      setup({ market: { ...snipeMarket, sqrtPriceX96: 2275703824434668340440887773871330n } });
      fireEvent.mouseDown(screen.getByRole("tab", { name: "trade.sell" }));
      fireEvent.click(screen.getByRole("tab", { name: "trade.sell" }));
      expect(screen.queryByTestId("snipe-tax")).not.toBeInTheDocument();
      expect(screen.getByTestId("trade-fee")).toHaveTextContent("1%");
    });

    it("shows nothing extra once the window has passed", () => {
      at(LAUNCHED + 40);
      setup({ market: snipeMarket });
      typeAmount("0.1");
      expect(screen.queryByTestId("snipe-tax")).not.toBeInTheDocument();
      expect(screen.getByTestId("trade-fee")).toHaveTextContent("0.001 ETH (1%)");
      expect(screen.getByTestId("trade-receive")).toHaveTextContent("89.72M");
    });
  });
});
