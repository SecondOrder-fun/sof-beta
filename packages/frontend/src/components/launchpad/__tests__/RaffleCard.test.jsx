import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import RaffleCard from "@/components/launchpad/RaffleCard";
import RaffleBadge from "@/components/launchpad/RaffleBadge";
import { useTokenSeasons } from "@/hooks/useLaunchActivity";
import { useCurveState } from "@/hooks/useCurveState";
import { usePlayerPosition } from "@/hooks/usePlayerPosition";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/useLaunchActivity", () => ({ useTokenSeasons: vi.fn() }));
vi.mock("@/hooks/useCurveState", () => ({ useCurveState: vi.fn() }));
vi.mock("@/hooks/usePlayerPosition", () => ({ usePlayerPosition: vi.fn() }));
// The ladder chart and the countdown have their own tests; stub them here.
vi.mock("@/components/curve/MiniCurveChart", () => ({ default: () => <div>ticket-ladder</div> }));
vi.mock("@/components/common/CountdownTimer", () => ({ default: () => <span>countdown</span> }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key) }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const WINNER = "0x7a0000000000000000000000000000000000005d";
const ETH = 10n ** 18n;
const NOW = Math.floor(Date.now() / 1000);

const season = (over) => ({
  seasonId: 3,
  name: null,
  state: "live",
  token: TOKEN,
  startTime: NOW - 3600,
  endTime: NOW + 2 * 86400,
  participants: "312",
  tickets: "1532",
  prizePool: String(18_400_000n * ETH),
  winner: null,
  bondingCurve: "0x4444444444444444444444444444444444444444",
  ...over,
});

const LADDER = Array.from({ length: 10 }, (_, i) => ({ rangeTo: BigInt((i + 1) * 500), price: BigInt(1000 + i * 1000) * ETH }));

const setup = ({ featured = season(), noData = false, myTickets = 0n, isLoading = false, isError = false, market, curve } = {}) => {
  useTokenSeasons.mockReturnValue({ data: noData ? undefined : { featured }, isLoading, isError });
  useCurveState.mockReturnValue({
    curveStep: { step: 4n, price: 12_000n * ETH, rangeTo: 2000n },
    curveSupply: 1532n,
    allBondSteps: LADDER,
    isPriceLoading: false,
    ...curve,
  });
  usePlayerPosition.mockReturnValue({ position: myTickets ? { tickets: myTickets, probBps: 261 } : null });
  return render(
    <MemoryRouter>
      <RaffleCard token={TOKEN} symbol="POND" market={market} />
    </MemoryRouter>,
  );
};

describe("RaffleCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("live: shows the prize pool in the token, the stats, the ladder and the primary CTA", () => {
    setup();
    expect(screen.getByText("raffle.badgeLive")).toBeInTheDocument();
    expect(screen.getByText('raffle.season{"id":3}')).toBeInTheDocument();
    expect(screen.getByText("18.4M")).toBeInTheDocument();
    expect(screen.getByText('raffle.ticketPrice{"price":"12K","symbol":"POND"}')).toBeInTheDocument();
    expect(screen.getByText("1,532")).toBeInTheDocument();
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText("ticket-ladder")).toBeInTheDocument();
    // On-chain step index 4 is the fifth step.
    expect(screen.getByText('raffle.step{"step":5,"total":10}')).toBeInTheDocument();
  });

  it("live: without an indexed current step, prices the next ticket from the ladder", () => {
    // 1532 sold: the first step whose range reaches it is the fourth (to 2000, 4K).
    const { container } = setup({ curve: { curveStep: null } });
    expect(screen.getByText('raffle.ticketPrice{"price":"4K","symbol":"POND"}')).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
    // No current step, so no "step N of M" label either.
    expect(screen.queryByText(/raffle\.step/)).not.toBeInTheDocument();
  });

  it("live: past the last step's range, prices the next ticket at the last step", () => {
    setup({ curve: { curveStep: null, curveSupply: 9999n } });
    expect(screen.getByText('raffle.ticketPrice{"price":"10K","symbol":"POND"}')).toBeInTheDocument();
  });

  it("live: a skeleton only while the price is loading, a dash once it is known to be missing", () => {
    const { container, unmount } = setup({ curve: { curveStep: null, allBondSteps: [], isPriceLoading: true } });
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    unmount();
    const second = setup({ curve: { curveStep: null, allBondSteps: [], isPriceLoading: false } });
    expect(second.container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("live: the CTA goes to the season", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: 'raffle.enter{"symbol":"POND"}' }));
    expect(navigate).toHaveBeenCalledWith("/raffles/3");
  });

  it("live: prices the pool in ETH from the pool price, never USD", () => {
    // 18.4M tokens at 50 gwei each = 0.92 ETH.
    setup({ market: { priceWei: 50n * 10n ** 9n } });
    expect(screen.getByText('raffle.prizeEth{"eth":"0.92"}')).toBeInTheDocument();
  });

  it("live: omits the ETH equivalent until the pool is priced", () => {
    setup();
    expect(screen.queryByText(/raffle\.prizeEth/)).not.toBeInTheDocument();
  });

  it("live: shows your tickets and chance only when you hold some", () => {
    setup();
    expect(screen.queryByText("raffle.yourTickets")).not.toBeInTheDocument();
    vi.clearAllMocks();
    setup({ myTickets: 40n });
    expect(screen.getByText("raffle.yourTickets")).toBeInTheDocument();
    expect(screen.getByText('raffle.chance{"pct":"2.6"}')).toBeInTheDocument();
  });

  it("upcoming: states the starting ticket price and disables the CTA", () => {
    setup({ featured: season({ state: "upcoming", startTime: NOW + 7800 }) });
    expect(screen.getByText('raffle.upcomingBody{"price":"1K","symbol":"POND"}')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "raffle.opensSoonCta" })).toBeDisabled();
  });

  it("drawing: explains the VRF draw and offers no CTA", () => {
    setup({ featured: season({ state: "drawing" }) });
    expect(screen.getByText('raffle.drawingBody{"count":312}')).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ended: names the winner and prize, and offers the next season", () => {
    setup({ featured: season({ state: "ended", winner: WINNER }) });
    expect(screen.getByText(/raffle\.wonTitle.*"prize":"18\.4M","symbol":"POND"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "raffle.openNext" }));
    expect(navigate).toHaveBeenCalledWith("/create-season");
  });

  it("cancelled: says so rather than naming a winner", () => {
    setup({ featured: season({ state: "cancelled" }) });
    expect(screen.getByText(/raffle\.cancelledTitle/)).toBeInTheDocument();
    expect(screen.queryByText(/raffle\.wonTitle/)).not.toBeInTheDocument();
  });

  it("none: invites the first season", () => {
    setup({ featured: null });
    expect(screen.getByText("raffle.badgeNone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "raffle.openFirst" })).toBeInTheDocument();
  });

  it("error with nothing cached: says the raffle is unavailable, with no CTA and no no-raffle claim", () => {
    setup({ noData: true, isError: true });
    expect(screen.getByText("raffle.unavailable")).toBeInTheDocument();
    expect(screen.queryByText("raffle.badgeNone")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("error on a refetch: keeps showing the cached season", () => {
    setup({ isError: true });
    expect(screen.getByText("raffle.badgeLive")).toBeInTheDocument();
    expect(screen.queryByText("raffle.unavailable")).not.toBeInTheDocument();
  });

  it("loading: a skeleton, not the no-raffle state", () => {
    setup({ noData: true, isLoading: true });
    expect(screen.queryByText("raffle.badgeNone")).not.toBeInTheDocument();
  });
});

describe("RaffleBadge", () => {
  const renderBadge = (raffle) => render(<RaffleBadge raffle={raffle} />);

  it("renders one badge per state", () => {
    const { rerender } = renderBadge({ state: "live" });
    expect(screen.getByText("raffle.badgeLive")).toBeInTheDocument();
    rerender(<RaffleBadge raffle={{ state: "upcoming", startTime: NOW + 7200 }} />);
    expect(screen.getByText(/raffle\.badgeOpensIn/)).toBeInTheDocument();
    rerender(<RaffleBadge raffle={{ state: "upcoming", startTime: NOW - 10 }} />);
    expect(screen.getByText("raffle.badgeOpensSoon")).toBeInTheDocument();
    rerender(<RaffleBadge raffle={{ state: "drawing" }} />);
    expect(screen.getByText("raffle.badgeDrawing")).toBeInTheDocument();
    rerender(<RaffleBadge raffle={{ state: "ended" }} />);
    expect(screen.getByText("raffle.badgeEnded")).toBeInTheDocument();
    rerender(<RaffleBadge raffle={{ state: "cancelled" }} />);
    expect(screen.getByText("raffle.badgeEnded")).toBeInTheDocument();
  });

  it("renders nothing without a raffle", () => {
    const { container } = renderBadge(null);
    expect(container).toBeEmptyDOMElement();
  });

  describe("with a moving clock", () => {
    afterEach(() => vi.useRealTimers());

    it("keeps the opens-in countdown current instead of freezing at first render", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
      const startTime = Math.floor(Date.now() / 1000) + 2 * 3600 + 10 * 60;
      renderBadge({ state: "upcoming", startTime });
      expect(screen.getByText('raffle.badgeOpensIn{"time":"2h 10m"}')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByText('raffle.badgeOpensIn{"time":"2h 9m"}')).toBeInTheDocument();
    });
  });
});
