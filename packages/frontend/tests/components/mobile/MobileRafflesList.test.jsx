/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: () => ({
    curveSupply: 0n,
    curveStep: { price: 0n },
    allBondSteps: [],
  }),
}));

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({
    data: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/components/common/Carousel", () => ({
  __esModule: true,
  default: ({ items, currentIndex, renderItem }) => (
    <div data-testid="carousel">
      {renderItem(items[currentIndex], currentIndex)}
    </div>
  ),
}));

vi.mock("@/components/mobile/SeasonCard", () => ({
  __esModule: true,
  default: ({ seasonId, onBuy }) => (
    <div data-testid={`season-card-${seasonId}`}>
      <button type="button" onClick={onBuy}>
        buy
      </button>
    </div>
  ),
}));

import MobileRafflesList from "@/components/mobile/MobileRafflesList";

const createSeason = (id) => ({
  id,
  status: 1,
  config: {
    name: `Season ${id}`,
    bondingCurve: `0x${id}`.padEnd(42, "0"),
    endTime: Date.now() + 60_000,
  },
});

/**
 * Render the mobile list with router context.
 * @param {Object} props
 */
const renderList = (props) =>
  render(
    <MemoryRouter>
      <MobileRafflesList {...props} />
    </MemoryRouter>,
  );

describe("MobileRafflesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the most recent season in the carousel", () => {
    const seasons = [createSeason(3), createSeason(2)];

    renderList({ seasons, onBuy: vi.fn(), onSell: vi.fn() });

    expect(screen.getByTestId("season-card-3")).toBeInTheDocument();
  });

  it("shows loading skeleton while fetching", () => {
    const { container } = renderList({
      seasons: [],
      isLoading: true,
      onBuy: vi.fn(),
      onSell: vi.fn(),
    });

    // Skeleton renders animated pulse elements instead of text
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("noActiveSeasons")).not.toBeInTheDocument();
  });

  it("shows empty state when no seasons exist", () => {
    renderList({
      seasons: [],
      isLoading: false,
      onBuy: vi.fn(),
      onSell: vi.fn(),
    });

    expect(screen.getByText("noActiveSeasons")).toBeInTheDocument();
  });

  it("calls onBuy when tapping the buy button", () => {
    const onBuy = vi.fn();
    const seasons = [createSeason(1)];

    renderList({ seasons, onBuy, onSell: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "buy" }));

    expect(onBuy).toHaveBeenCalledTimes(1);
  });
});
