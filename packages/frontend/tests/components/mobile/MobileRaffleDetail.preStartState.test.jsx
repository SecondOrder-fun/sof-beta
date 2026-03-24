/*
  @vitest-environment jsdom
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, params) => params?.defaultValue || key,
  }),
}));

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({ data: null }),
}));

// CountdownTimer uses number-flow + internal countdown logic; stub to a predictable output.
vi.mock("@/components/common/CountdownTimer", () => ({
  default: () => <span>COUNTDOWN</span>,
}));

import MobileRaffleDetail from "@/components/mobile/MobileRaffleDetail";

describe("MobileRaffleDetail pre-start state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows countdown and 'Starting Price' before startTime, hides BUY/SELL", () => {
    const now = Math.floor(Date.now() / 1000);

    render(
      <MobileRaffleDetail
        seasonId={1}
        seasonConfig={{
          name: "Test Season",
          startTime: now + 3600,
          endTime: now + 7200,
        }}
        status={0}
        curveSupply={0n}
        maxSupply={100n}
        curveStep={{ price: 1n }}
        localPosition={{ tickets: 0n, probBps: 0, total: 0n }}
        totalPrizePool={0n}
        onBuy={vi.fn()}
        onSell={vi.fn()}
      />,
    );

    // Countdown timer is shown in the header area
    expect(screen.getByText("COUNTDOWN")).toBeInTheDocument();

    // Action buttons are removed entirely before start.
    expect(screen.queryByText("BUY")).not.toBeInTheDocument();
    expect(screen.queryByText("SELL")).not.toBeInTheDocument();

    // Price box now shows "Starting Price" instead of "Ticket Price" for pre-start
    expect(screen.getByText("Starting Price (SOF)")).toBeInTheDocument();
    expect(screen.queryByText("raffle:ticketPrice")).not.toBeInTheDocument();

    // Ends-in should not show before start.
    expect(screen.queryByText("raffle:endsIn")).not.toBeInTheDocument();
  });
});
