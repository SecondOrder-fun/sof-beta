// tests/components/mobile/MobileMarketsList.empty.test.jsx
// TDD: Verify MobileMarketsList returns null when markets is empty (no duplicate empty state)

import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import MobileMarketsList from "@/components/mobile/MobileMarketsList";

// Mock dependencies
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/hooks/useUserMarketPosition", () => ({
  useUserMarketPosition: () => ({ data: null }),
}));

vi.mock("@/components/common/skeletons/MobileCardSkeleton", () => ({
  default: () => <div data-testid="skeleton" />,
}));

vi.mock("@/components/mobile/MobileMarketCard", () => ({
  default: ({ market }) => <div data-testid="market-card">{market.id}</div>,
}));

vi.mock("@/components/common/Carousel", () => ({
  default: () => <div data-testid="carousel" />,
}));

describe("MobileMarketsList - empty state", () => {
  test("returns null when markets array is empty (defers to parent)", () => {
    const { container } = render(
      <MobileMarketsList markets={[]} isLoading={false} />
    );

    // Should render nothing — parent handles the empty state
    expect(container.innerHTML).toBe("");
  });

  test("renders carousel when markets are present", () => {
    const markets = [{ id: 1, question: "Test?" }];
    const { container } = render(
      <MobileMarketsList markets={markets} isLoading={false} />
    );

    // Should render content
    expect(container.innerHTML).not.toBe("");
  });
});
