import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import LaunchTrades from "@/components/launchpad/LaunchTrades";
import { useWarmRead } from "@/hooks/chain/useWarmRead";

vi.mock("@/hooks/chain/useWarmRead", () => ({ useWarmRead: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const TRADER = "0x3f000000000000000000000000000000000000a1";
const USDC = { address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", symbol: "USDC", decimals: 6 };

// A row as GET /launchpad/tokens/:address/trades returns it: no quote fields.
const trade = (over = {}) => ({
  txHash: "0xabc",
  logIndex: 0,
  token: TOKEN,
  trader: TRADER,
  side: "BUY",
  quoteAmount: "100000000000000000",
  tokenAmount: "5000000000000000000000000",
  priceE18: "1000000000000000000000000000", // 1 gwei per token
  blockTime: new Date().toISOString(),
  ...over,
});

const setup = (trades, quote) => {
  useWarmRead.mockReturnValue({ data: { trades }, isLoading: false, isError: false });
  return render(<LaunchTrades token={TOKEN} quote={quote} />);
};

describe("LaunchTrades", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prints an ETH trade's price in gwei per token", () => {
    setup([trade()]);
    expect(screen.getByText("1 gwei")).toBeInTheDocument();
    expect(screen.getByText("0.1")).toBeInTheDocument();
  });

  // 2.5 raw USDC units per token: as an integer of raw units it read 0.000002.
  it("prints a USDC trade in USDC with the price's full precision, from the page's quote", () => {
    setup([trade({ quoteAmount: "25000000", priceE18: "2500000000000000000" })], USDC);
    expect(screen.getByText("0.0000025 USDC")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "USDC" })).toBeInTheDocument();
  });

  it("shows a dash for a trade with no price", () => {
    setup([trade({ priceE18: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
