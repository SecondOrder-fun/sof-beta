import { render, screen, fireEvent } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TokenDetail from "@/routes/TokenDetail";
import { useTokenLaunch } from "@/hooks/useTokenLaunches";
import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";
import { usePlatform } from "@/hooks/usePlatform";
import { useTokenSeasons } from "@/hooks/useLaunchActivity";
import { deriveMarketState } from "@/lib/v4PoolMath";

vi.mock("@/hooks/useTokenLaunches", () => ({ useTokenLaunch: vi.fn() }));
vi.mock("@/hooks/useLaunchMarkets", () => ({ useLaunchMarkets: vi.fn() }));
vi.mock("@/hooks/usePlatform", () => ({ usePlatform: vi.fn() }));
vi.mock("@/hooks/useLaunchActivity", () => ({ useTokenSeasons: vi.fn() }));
// The panel and the trade feed have their own tests; stub them to isolate the page.
vi.mock("@/components/launchpad/BuyPanel", () => ({ default: () => <div>buy-panel</div> }));
vi.mock("@/components/launchpad/LaunchTrades", () => ({ default: () => <div>trades</div> }));
vi.mock("@/components/launchpad/PriceChart", () => ({ default: () => <div>price-chart</div> }));
vi.mock("@/components/launchpad/RaffleCard", () => ({ default: () => <div>raffle-card</div> }));
// The card decides for itself whether to show (only for the fee recipient). The
// stub numbers each mount, so a test can see whether it was remounted.
vi.mock("@/components/launchpad/CreatorFeesCard", async () => {
  const { useState } = await import("react");
  let mounts = 0;
  const Card = ({ token, symbol }) => {
    const [mount] = useState(() => ++mounts);
    return <div data-testid="creator-fees" data-mount={mount}>{`creator-fees:${token}:${symbol}`}</div>;
  };
  return { default: Card };
});
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (key === "detail.factTradeFeeValue" ? `${opts.fee}% in ${opts.quote}` : key) }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const launch = {
  launchId: 0,
  token: TOKEN,
  creator: "0x2222222222222222222222222222222222222222",
  name: "Frog Pond",
  symbol: "POND",
  launchedAt: BigInt(Math.floor(Date.now() / 1000) - 7200),
  placementId: "0x0972042a90604aa539119bf09c589a9d1253c65e6fba97697364e1055c165df8",
  totalSupply: 1_000_000_000n * 10n ** 18n,
};
const market = deriveMarketState({
  slot0Word: "0x0000000000000000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  liquidityWord: "0x0",
  placement: { tickLower: -887200, tickUpper: 207200, liquidity: 31690866724818211737594n, tradeFee: 20_000 },
  wholeSupply: 1_000_000_000n,
  quote: { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18 },
});

const setup = ({ data = launch, mobile = false, path = `/tokens/${TOKEN}`, featured = null } = {}) => {
  useTokenLaunch.mockReturnValue({ data, isLoading: false, isAvailable: true });
  useTokenSeasons.mockReturnValue({ data: { seasons: featured ? [featured] : [], featured } });
  useLaunchMarkets.mockReturnValue({ markets: data ? { [TOKEN]: market } : {} });
  usePlatform.mockReturnValue({ isMobile: mobile });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tokens/:address" element={<TokenDetail />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("TokenDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the token, its price chart, supply sold and raffle card", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Frog Pond" })).toBeInTheDocument();
    expect(screen.getByText("price-chart")).toBeInTheDocument();
    expect(screen.getByText("raffle-card")).toBeInTheDocument();
    expect(screen.getByText("detail.soldLabel")).toBeInTheDocument();
    expect(screen.getByText("trades")).toBeInTheDocument();
  });

  it("hands the creator fees card this launch, beside the buy panel", () => {
    setup();
    expect(screen.getByText(`creator-fees:${TOKEN}:POND`)).toBeInTheDocument();
  });

  // The route stays mounted across /tokens/:address changes; the card's claimed /
  // handed-on state belongs to one token, so it must start fresh on another.
  it("remounts the creator fees card when the page moves to another token", () => {
    const OTHER = "0x3333333333333333333333333333333333333333";
    useTokenLaunch.mockImplementation((address) => ({
      data: { ...launch, token: address, symbol: address === OTHER ? "LAMP" : "POND" },
      isLoading: false,
      isAvailable: true,
    }));
    useTokenSeasons.mockReturnValue({ data: { seasons: [], featured: null } });
    useLaunchMarkets.mockReturnValue({ markets: {} });
    usePlatform.mockReturnValue({ isMobile: false });
    render(
      <MemoryRouter initialEntries={[`/tokens/${TOKEN}`]}>
        <Link to={`/tokens/${OTHER}`}>next</Link>
        <Routes>
          <Route path="/tokens/:address" element={<TokenDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    const first = screen.getByTestId("creator-fees").dataset.mount;
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByText(`creator-fees:${OTHER}:LAMP`)).toBeInTheDocument();
    expect(screen.getByTestId("creator-fees").dataset.mount).not.toBe(first);
  });

  it("puts the buy panel in the side column on desktop", () => {
    setup();
    expect(screen.getByText("buy-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "detail.buyCta" })).not.toBeInTheDocument();
  });

  it("on mobile, opens the buy panel in a sheet from the bottom bar", () => {
    setup({ mobile: true });
    expect(screen.queryByText("buy-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "detail.buyCta" }));
    expect(screen.getByText("buy-panel")).toBeInTheDocument();
  });

  it("shows the raffle badge beside the name when a season is priced in the token", () => {
    setup({ featured: { seasonId: 3, state: "live", prizePool: "0", tickets: "0", participants: "0" } });
    expect(screen.getByText("raffle.badgeLive")).toBeInTheDocument();
  });

  it("shows no raffle badge when the token has no season", () => {
    setup();
    expect(screen.queryByText("raffle.badgeLive")).not.toBeInTheDocument();
    expect(screen.queryByText("raffle.badgeEnded")).not.toBeInTheDocument();
  });

  it("keeps the raffle card on the page on mobile, outside the buy sheet", () => {
    setup({ mobile: true });
    expect(screen.getByText("raffle-card")).toBeInTheDocument();
  });

  it("states the ownerless facts", () => {
    setup();
    expect(screen.getByText("detail.factAllocationValue")).toBeInTheDocument();
    expect(screen.getByText("detail.factControlsValue")).toBeInTheDocument();
  });

  it("states the launch's own trade fee, in its quote", () => {
    setup();
    expect(screen.getByText("detail.factTradeFee")).toBeInTheDocument();
    expect(screen.getByText("2% in ETH")).toBeInTheDocument();
  });

  it("renders not-found for an address that is not a launch", () => {
    setup({ data: null });
    expect(screen.getByText("detail.notFoundTitle")).toBeInTheDocument();
  });

  it("renders not-found for a malformed address without querying it", () => {
    setup({ path: "/tokens/not-an-address" });
    expect(screen.getByText("detail.notFoundTitle")).toBeInTheDocument();
    expect(useTokenLaunch).toHaveBeenCalledWith(undefined);
  });
});
