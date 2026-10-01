import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import TokenCard from "@/components/launchpad/TokenCard";
import { useNow } from "@/hooks/useNow";

// Echo the key and options, except the time units, which read as English so a
// countdown is legible in assertions ("3h 5m").
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
// The real clock, wrapped so a test can see which cards run one.
vi.mock("@/hooks/useNow", async (importOriginal) => {
  const actual = await importOriginal();
  return { useNow: vi.fn(actual.useNow) };
});

const TOKEN = "0x1111111111111111111111111111111111111111";
const ETH = 10n ** 18n;

const renderCard = (raffle, nowSec = Math.floor(Date.now() / 1000)) =>
  render(
    <MemoryRouter>
      <TokenCard launch={{ token: TOKEN, name: "Pond", symbol: "POND", launchedAt: nowSec - 3600 }} raffle={raffle} />
    </MemoryRouter>,
  );

describe("TokenCard raffle strip", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the time left current instead of freezing at first render", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const nowSec = Math.floor(Date.now() / 1000);
    renderCard(
      {
        state: "live",
        seasonId: 3,
        name: null,
        prizePool: String(18_400_000n * ETH),
        endTime: nowSec + 3 * 3600 + 5 * 60,
      },
      nowSec,
    );
    expect(screen.getByText('card.raffleLeft{"time":"3h 5m"}')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('card.raffleLeft{"time":"3h 4m"}')).toBeInTheDocument();
  });

  it("names the prize pool when there is one", () => {
    renderCard({ state: "live", seasonId: 3, name: null, prizePool: String(18_400_000n * ETH) });
    expect(
      screen.getByText('card.raffleStrip{"season":"raffle.season{\\"id\\":3}","prize":"18.4M","symbol":"POND"}'),
    ).toBeInTheDocument();
  });

  it.each([
    ["a zero pool", "0"],
    ["no pool at all", undefined],
  ])("with %s, shows the season alone rather than '0 POND'", (_label, prizePool) => {
    renderCard({ state: "live", seasonId: 3, name: null, prizePool });
    expect(screen.getByText('raffle.season{"id":3}')).toBeInTheDocument();
    expect(screen.queryByText(/card\.raffleStrip/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"prize":"0"/)).not.toBeInTheDocument();
  });
});

describe("TokenCard clock", () => {
  beforeEach(() => vi.clearAllMocks());

  const nowSec = Math.floor(Date.now() / 1000);

  it.each([
    ["no raffle", undefined],
    ["an ended raffle", { state: "ended", seasonId: 1 }],
    ["a drawing raffle", { state: "drawing", seasonId: 1 }],
    ["a live raffle with no end time", { state: "live", seasonId: 1, prizePool: "0" }],
    ["an upcoming raffle with no start time", { state: "upcoming", seasonId: 1 }],
  ])("runs no timer for %s, where no countdown is shown", (_label, raffle) => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    renderCard(raffle);
    expect(useNow).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("runs one for a live raffle's time left", () => {
    renderCard({ state: "live", seasonId: 1, prizePool: "0", endTime: nowSec + 3600 });
    expect(useNow).toHaveBeenCalled();
  });

  it("runs one for an upcoming raffle's opens-in badge", () => {
    renderCard({ state: "upcoming", seasonId: 1, startTime: nowSec + 3600 });
    expect(useNow).toHaveBeenCalled();
    expect(screen.getByText(/raffle\.badgeOpensIn/)).toBeInTheDocument();
  });
});
