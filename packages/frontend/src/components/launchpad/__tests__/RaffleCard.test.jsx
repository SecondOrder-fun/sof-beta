import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const setup = ({ featured = season(), myTickets = 0n, isLoading = false, market } = {}) => {
  useTokenSeasons.mockReturnValue({ data: featured === undefined ? undefined : { featured }, isLoading });
  useCurveState.mockReturnValue({
    curveStep: { step: 4n, price: 12_000n * ETH, rangeTo: 2000n },
    curveSupply: 1532n,
    allBondSteps: Array.from({ length: 10 }, (_, i) => ({ rangeTo: BigInt((i + 1) * 500), price: BigInt(1000 + i * 1000) * ETH })),
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
    expect(screen.getByText("12K POND")).toBeInTheDocument();
    expect(screen.getByText("1,532")).toBeInTheDocument();
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText("ticket-ladder")).toBeInTheDocument();
    expect(screen.getByText('raffle.step{"step":4,"total":10}')).toBeInTheDocument();
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

  it("loading: a skeleton, not the no-raffle state", () => {
    setup({ featured: undefined, isLoading: true });
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
});
