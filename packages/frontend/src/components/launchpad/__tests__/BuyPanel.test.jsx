import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import BuyPanel from "@/components/launchpad/BuyPanel";
import { deriveMarketState } from "@/lib/v4PoolMath";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts?.symbol ? `${key}:${opts.symbol}` : key) }),
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal()),
  useBalance: () => ({ data: { value: 2n * 10n ** 18n } }),
}));
vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: "0x9999999999999999999999999999999999999999" }),
}));
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

  // Honest about what is not built: there is no router contract to execute a
  // swap yet, so the button never becomes clickable.
  it("keeps the trade button disabled and explains why", () => {
    setup();
    typeAmount("0.1");
    expect(screen.getByRole("button", { name: "trade.buyCta:POND" })).toBeDisabled();
    expect(screen.getByText("trade.notOpen")).toBeInTheDocument();
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
