/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: "en" },
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({
    isLoading: false,
    error: null,
    data: {
      winnerAddress: "0x1111111111111111111111111111111111111111",
      winnerUsername: null,
      grandPrizeWei: 1230000000000000000n,
    },
  }),
}));

vi.mock("@/components/user/UsernameDisplay", () => ({
  __esModule: true,
  default: ({ address }) => <span>{address}</span>,
}));

vi.mock("@/components/curve/CurveGraph", () => ({
  __esModule: true,
  default: () => <div />,
}));

import SeasonCard from "@/components/mobile/SeasonCard.jsx";

describe("SeasonCard completed winner display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders winner + grand prize and disables actions when completed", () => {
    const onBuy = vi.fn();
    const onSell = vi.fn();

    render(
      <SeasonCard
        seasonId={2}
        seasonConfig={{ name: "Completed Season", endTime: "9999999999" }}
        status={5}
        curveStep={{ price: 0n }}
        allBondSteps={[]}
        curveSupply={0n}
        onBuy={onBuy}
        onSell={onSell}
      />,
    );

    expect(screen.getByText("raffle:winner")).toBeInTheDocument();
    expect(
      screen.getByText("0x1111111111111111111111111111111111111111"),
    ).toBeInTheDocument();

    expect(screen.queryByText("BUY")).not.toBeInTheDocument();
    expect(screen.queryByText("SELL")).not.toBeInTheDocument();

    expect(onBuy).not.toHaveBeenCalled();
    expect(onSell).not.toHaveBeenCalled();
  });

  it("hides price + buy/sell and shows ended message when endTime has passed", () => {
    const onBuy = vi.fn();
    const onSell = vi.fn();

    const nowSec = Math.floor(Date.now() / 1000);

    render(
      <SeasonCard
        seasonId={12}
        seasonConfig={{ name: "Ended Season", endTime: String(nowSec - 5) }}
        status={1}
        curveStep={{ price: 10000000000000000000n }}
        allBondSteps={[]}
        curveSupply={0n}
        onBuy={onBuy}
        onSell={onSell}
      />,
    );

    expect(screen.getByText("common:tradingLocked")).toBeInTheDocument();
    expect(screen.getByText("raffle:raffleEnded")).toBeInTheDocument();

    expect(screen.queryByText("Current Price")).not.toBeInTheDocument();
    expect(screen.queryByText("BUY")).not.toBeInTheDocument();
    expect(screen.queryByText("SELL")).not.toBeInTheDocument();
  });
});
