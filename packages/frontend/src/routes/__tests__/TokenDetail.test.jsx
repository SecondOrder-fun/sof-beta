import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TokenDetail from "@/routes/TokenDetail";
import { useTokenLaunch } from "@/hooks/useTokenLaunches";
import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";
import { usePlatform } from "@/hooks/usePlatform";
import { deriveMarketState } from "@/lib/v4PoolMath";

vi.mock("@/hooks/useTokenLaunches", () => ({ useTokenLaunch: vi.fn() }));
vi.mock("@/hooks/useLaunchMarkets", () => ({ useLaunchMarkets: vi.fn() }));
vi.mock("@/hooks/usePlatform", () => ({ usePlatform: vi.fn() }));
// The panel and the trade feed have their own tests; stub them to isolate the page.
vi.mock("@/components/launchpad/BuyPanel", () => ({ default: () => <div>buy-panel</div> }));
vi.mock("@/components/launchpad/LaunchTrades", () => ({ default: () => <div>trades</div> }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
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
  slot0Word: "0x0000000027100000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  liquidityWord: "0x0",
  placement: { tickLower: 161200, tickUpper: 207200, liquidity: 35222655548218972599314n },
  wholeSupply: 1_000_000_000n,
});

const setup = ({ data = launch, mobile = false, path = `/tokens/${TOKEN}` } = {}) => {
  useTokenLaunch.mockReturnValue({ data, isLoading: false, isAvailable: true });
  useLaunchMarkets.mockReturnValue({ markets: data ? { [TOKEN]: market } : {} });
  usePlatform.mockReturnValue({ isMobile: mobile, isMobileBrowser: false });
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

  it("shows the token, its live valuation and supply sold", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Frog Pond" })).toBeInTheDocument();
    expect(screen.getByText("detail.fdvLabel")).toBeInTheDocument();
    expect(screen.getByText("detail.soldLabel")).toBeInTheDocument();
    expect(screen.getByText("trades")).toBeInTheDocument();
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

  it("states the ownerless facts", () => {
    setup();
    expect(screen.getByText("detail.factAllocationValue")).toBeInTheDocument();
    expect(screen.getByText("detail.factControlsValue")).toBeInTheDocument();
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
