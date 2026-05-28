/*
  @vitest-environment jsdom
*/
/* eslint-disable react/prop-types */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeasonCard } from "@/components/mobile/SeasonCard";

// Per-test override surface for useCurveState.
let curveStateMock = {
  curveSupply: 0n,
  curveStep: null,
  allBondSteps: [],
  curveReserves: 0n,
};
vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: () => curveStateMock,
}));
vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({ data: null }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k) => k }),
}));
vi.mock("@/components/curve/MiniCurveChart", () => ({
  default: () => <div data-testid="mini-curve" />,
}));
vi.mock("@/components/common/CountdownTimer", () => ({
  default: ({ targetTimestamp }) => <span>{String(targetTimestamp)}</span>,
}));
vi.mock("@/components/user/UsernameDisplay", () => ({
  default: ({ address }) => <span>{address}</span>,
}));

const PAST = BigInt(Math.floor(Date.now() / 1000) - 3600);
const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 86400);

beforeEach(() => {
  curveStateMock = {
    curveSupply: 0n,
    curveStep: null,
    allBondSteps: [
      { rangeTo: 100n, price: 2000000000000000000n }, // 2 SOF
      { rangeTo: 200n, price: 3000000000000000000n },
    ],
    curveReserves: 0n,
  };
});

describe("mobile SeasonCard price label/value", () => {
  // Finding 1: Upcoming is status-driven, not time-driven. A status=0 season
  // whose startTime has already elapsed (status not yet flipped to Active)
  // must still show the Starting Price, not "Current Price: 0".
  it("status=0 with elapsed startTime shows Starting Price from step 0", () => {
    render(
      <SeasonCard
        seasonId={3}
        status={0}
        seasonConfig={{ name: "T", startTime: PAST, endTime: FUTURE, bondingCurve: "0xa" }}
      />,
    );
    expect(screen.getByText("raffle:startingPrice")).toBeInTheDocument();
    expect(screen.queryByText("raffle:currentPrice")).not.toBeInTheDocument();
    expect(screen.getByText(/^2 SOF/)).toBeInTheDocument();
    expect(screen.queryByText(/^0 SOF/)).not.toBeInTheDocument();
  });

  // Finding 2: Active season before its first trade has curveStep === null;
  // the current price is the starting tier, so it must fall back to step 0
  // rather than rendering 0.
  it("active season pre-first-trade falls back to step-0 price", () => {
    render(
      <SeasonCard
        seasonId={4}
        status={1}
        seasonConfig={{ name: "T", startTime: PAST, endTime: FUTURE, bondingCurve: "0xa" }}
      />,
    );
    expect(screen.getByText("raffle:currentPrice")).toBeInTheDocument();
    expect(screen.getByText(/^2 SOF/)).toBeInTheDocument();
    expect(screen.queryByText(/^0 SOF/)).not.toBeInTheDocument();
  });
});
