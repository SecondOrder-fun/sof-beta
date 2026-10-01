import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import RaffleCard from "@/components/launchpad/RaffleCard";
import RaffleBadge from "@/components/launchpad/RaffleBadge";
import { useTokenSeasons } from "@/hooks/useLaunchActivity";
import { useCurveState } from "@/hooks/useCurveState";
import { useLiveParticipantCount } from "@/hooks/useLiveParticipantCount";
import { usePlayerPosition } from "@/hooks/usePlayerPosition";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/useLaunchActivity", () => ({ useTokenSeasons: vi.fn() }));
vi.mock("@/hooks/useCurveState", () => ({ useCurveState: vi.fn() }));
vi.mock("@/hooks/usePlayerPosition", () => ({ usePlayerPosition: vi.fn() }));
vi.mock("@/hooks/useLiveParticipantCount", () => ({ useLiveParticipantCount: vi.fn() }));
// The ladder chart and the countdown have their own tests; stub them here.
const miniCurve = vi.hoisted(() => ({ props: null }));
vi.mock("@/components/curve/MiniCurveChart", () => ({
  default: (props) => {
    miniCurve.props = props;
    return <div>ticket-ladder</div>;
  },
}));
vi.mock("@/components/common/CountdownTimer", () => ({ default: () => <span>countdown</span> }));
// Echo the key and options, except the time units, which read as English so a
// countdown is legible in assertions ("2h 10m").
vi.mock("react-i18next", async (importOriginal) => {
  const units = { "time.days": "d", "time.hours": "h", "time.minutes": "m" };
  const t = (key, opts) =>
    key === "time.pair"
      ? `${opts.first} ${opts.second}`
      : units[key]
        ? `${opts.count}${units[key]}`
        : opts
          ? `${key}${JSON.stringify(opts)}`
          : key;
  return { ...(await importOriginal()), useTranslation: () => ({ t }) };
});

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

const setup = ({ featured = season(), noData = false, myTickets = 0n, isLoading = false, isError = false, market, curve, livePlayers } = {}) => {
  // No live event yet: the hook hands back the summary count it was seeded with.
  useLiveParticipantCount.mockImplementation((_id, { initialCount }) => livePlayers ?? initialCount);
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
    expect(screen.getByText('raffle.ticketPrice{"price":"12,000","symbol":"POND"}')).toBeInTheDocument();
    expect(screen.getByText("1,532")).toBeInTheDocument();
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText("ticket-ladder")).toBeInTheDocument();
    // On-chain step index 4 is the fifth step.
    expect(screen.getByText('raffle.step{"step":5,"total":10}')).toBeInTheDocument();
  });

  it("live: without an indexed current step, prices the next ticket from the ladder", () => {
    // 1532 sold: the first step whose range reaches it is the fourth (to 2000, 4K).
    const { container } = setup({ curve: { curveStep: null } });
    expect(screen.getByText('raffle.ticketPrice{"price":"4,000","symbol":"POND"}')).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
    // No current step, so no "step N of M" label either.
    expect(screen.queryByText(/raffle\.step/)).not.toBeInTheDocument();
  });

  it("live: past the last step's range, prices the next ticket at the last step", () => {
    setup({ curve: { hasState: true, curveStep: null, curveSupply: 9999n } });
    expect(screen.getByText('raffle.ticketPrice{"price":"10,000","symbol":"POND"}')).toBeInTheDocument();
  });

  describe("at an exact step boundary, the next ticket is on the next step", () => {
    // 2000 sold fills the fourth step (to 2000, 4K) exactly; ticket 2001 costs 5K.
    it("even though the indexed current step still points at the filled one", () => {
      setup({ curve: { curveStep: { step: 3n, price: LADDER[3].price, rangeTo: 2000n }, curveSupply: 2000n, hasState: true } });
      expect(screen.getByText('raffle.ticketPrice{"price":"5,000","symbol":"POND"}')).toBeInTheDocument();
      expect(screen.getByText('raffle.step{"step":5,"total":10}')).toBeInTheDocument();
    });

    it("from the ladder when there is no indexed current step", () => {
      setup({ curve: { curveStep: null, curveSupply: 2000n, hasState: true } });
      expect(screen.getByText('raffle.ticketPrice{"price":"5,000","symbol":"POND"}')).toBeInTheDocument();
    });

    it("and one ticket short of the boundary is still on the current step", () => {
      setup({ curve: { curveStep: { step: 3n, price: LADDER[3].price, rangeTo: 2000n }, curveSupply: 1999n, hasState: true } });
      expect(screen.getByText('raffle.ticketPrice{"price":"4,000","symbol":"POND"}')).toBeInTheDocument();
      expect(screen.getByText('raffle.step{"step":4,"total":10}')).toBeInTheDocument();
    });
  });

  it("live: prices a ticket with its fraction rather than truncating to whole tokens", () => {
    setup({ curve: { hasState: true, curveStep: { step: 0n, price: ETH / 2n, rangeTo: 500n }, curveSupply: 10n } });
    expect(screen.getByText('raffle.ticketPrice{"price":"0.5","symbol":"POND"}')).toBeInTheDocument();
  });

  it("live: reads the pool, tickets and players live, not from the lagging season summary", () => {
    // The summary still says 18.4M / 1,532 / 312; the chain has moved on.
    setup({ curve: { hasState: true, curveReserves: 25_000_000n * ETH, curveSupply: 1800n }, livePlayers: 340 });
    expect(screen.getByText("25M")).toBeInTheDocument();
    expect(screen.getByText("1,800")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();
    expect(screen.queryByText("18.4M")).not.toBeInTheDocument();
    expect(screen.queryByText("312")).not.toBeInTheDocument();
    expect(useLiveParticipantCount).toHaveBeenCalledWith(3, { initialCount: 312 });
  });

  it("live: before the curve state loads, the next ticket and the ladder use the summary's tickets, not the 0 placeholder", () => {
    // The hook's placeholder supply is 0n until the state arrives; 1,532 are sold.
    setup({ curve: { hasState: false, curveStep: null, curveSupply: 0n } });
    // 1,532 sits on the fourth step (to 2000, 4K) — not the first (1K), as 0 would say.
    expect(screen.getByText('raffle.ticketPrice{"price":"4,000","symbol":"POND"}')).toBeInTheDocument();
    expect(miniCurve.props.curveSupply).toBe(1532n);
    expect(screen.getByText("1,532")).toBeInTheDocument();
  });

  it("live: once the curve state loads, the ladder follows it", () => {
    setup({ curve: { hasState: true, curveReserves: 25_000_000n * ETH, curveSupply: 1800n } });
    expect(miniCurve.props.curveSupply).toBe(1800n);
  });

  it("live: keeps a small pool's ETH equivalent instead of rounding it to 0", () => {
    // 80K tokens at 50 gwei each = 0.004 ETH.
    setup({ curve: { hasState: true, curveReserves: 80_000n * ETH, curveSupply: 10n }, market: { priceWei: 50n * 10n ** 9n } });
    expect(screen.getByText('raffle.prizeEth{"eth":"0.004"}')).toBeInTheDocument();
  });

  it("live: prices the pool in ETH from the live reserves", () => {
    // 25M tokens at 50 gwei each = 1.25 ETH.
    setup({ curve: { hasState: true, curveReserves: 25_000_000n * ETH, curveSupply: 1800n }, market: { priceWei: 50n * 10n ** 9n } });
    expect(screen.getByText('raffle.prizeEth{"eth":"1.25"}')).toBeInTheDocument();
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
    expect(screen.getByText('raffle.upcomingBody{"price":"1,000","symbol":"POND"}')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "raffle.opensSoonCta" })).toBeDisabled();
  });

  it("drawing: explains the VRF draw and offers no CTA", () => {
    setup({ featured: season({ state: "drawing" }) });
    expect(screen.getByText('raffle.drawingBody{"count":312}')).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ended: names the winner and their grand prize, and offers the next season", () => {
    setup({ featured: season({ state: "ended", winner: WINNER, grandPrize: String(12_000_000n * ETH) }) });
    expect(screen.getByText(/raffle\.wonTitle.*"prize":"12M","symbol":"POND"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "raffle.openNext" }));
    // The next season is priced in this token: /create-season preselects it.
    expect(navigate).toHaveBeenCalledWith(`/create-season?quoteToken=${TOKEN}`);
  });

  it("ended: applies the season's grand-prize share to the pool when only the bps is known", () => {
    // 65% of 18.4M = 11.96M, not the whole 18.4M.
    setup({ featured: season({ state: "ended", winner: WINNER, grandPrizeBps: 6500 }) });
    expect(screen.getByText(/raffle\.wonTitle.*"prize":"11\.96M","symbol":"POND"/)).toBeInTheDocument();
  });

  it("ended: with the split unknown, names the season won and claims no amount", () => {
    setup({ featured: season({ state: "ended", winner: WINNER }) });
    expect(screen.getByText(/raffle\.wonSeasonTitle.*"season":"raffle\.season/)).toBeInTheDocument();
    expect(screen.queryByText(/raffle\.wonTitle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/18\.4M/)).not.toBeInTheDocument();
  });

  it("cancelled: says so rather than naming a winner", () => {
    setup({ featured: season({ state: "cancelled" }) });
    expect(screen.getByText(/raffle\.cancelledTitle/)).toBeInTheDocument();
    expect(screen.queryByText(/raffle\.wonTitle/)).not.toBeInTheDocument();
  });

  it("cancelled: badged and labelled cancelled, not ended", () => {
    setup({ featured: season({ state: "cancelled" }) });
    expect(screen.getByText("raffle.badgeCancelled")).toBeInTheDocument();
    expect(screen.queryByText("raffle.badgeEnded")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: 'raffle.cardLabel{"state":"raffle.badgeCancelled"}' })).toBeInTheDocument();
  });

  it("ended: labelled ended", () => {
    setup({ featured: season({ state: "ended", winner: WINNER }) });
    expect(screen.getByRole("region", { name: 'raffle.cardLabel{"state":"raffle.badgeEnded"}' })).toBeInTheDocument();
  });

  it("none: invites the first season, priced in this token", () => {
    setup({ featured: null });
    expect(screen.getByText("raffle.badgeNone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "raffle.openFirst" }));
    expect(navigate).toHaveBeenCalledWith(`/create-season?quoteToken=${TOKEN}`);
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
    expect(screen.getByText("raffle.badgeCancelled")).toBeInTheDocument();
    expect(screen.queryByText("raffle.badgeEnded")).not.toBeInTheDocument();
  });

  it("styles a cancelled raffle like an ended one", () => {
    const { rerender } = renderBadge({ state: "ended" });
    const ended = screen.getByText("raffle.badgeEnded").className;
    rerender(<RaffleBadge raffle={{ state: "cancelled" }} />);
    expect(screen.getByText("raffle.badgeCancelled").className).toBe(ended);
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
