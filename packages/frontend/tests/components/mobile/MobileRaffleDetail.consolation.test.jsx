// tests/components/mobile/MobileRaffleDetail.consolation.test.jsx
// TDD: Verify consolation prize uses computed grandPrize, not hardcoded 65%

import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileRaffleDetail } from "@/components/mobile/MobileRaffleDetail";

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      const map = {
        "raffle:season": "Season",
        "raffle:ticketPrice": "Ticket Price",
        "raffle:yourTickets": "Your Tickets",
        "raffle:winChance": "Win Chance",
        "raffle:grandPrize": "Grand Prize",
        "raffle:consolationPrize": "Consolation Prize",
        "raffle:player": "player",
        "raffle:sold": "sold",
        "raffle:max": "max",
        "raffle:raffleEnded": "Raffle Ended",
        "common:buy": "Buy",
        "common:sell": "Sell",
      };
      return map[key] || opts?.defaultValue || key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock winner summary hook - return a specific grandPrizeWei
vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: vi.fn(),
}));

import { useSeasonWinnerSummary } from "@/hooks/useSeasonWinnerSummaries";

/* eslint-disable react/prop-types */
// Mock minimal UI components
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }) => <div data-testid="card" {...props}>{children}</div>,
  CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: () => <div data-testid="progress" />,
}));

vi.mock("@/components/ui/content-box", () => ({
  ImportantBox: ({ children, ...props }) => <div {...props}>{children}</div>,
}));
/* eslint-enable react/prop-types */

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/common/CountdownTimer", () => ({
  default: () => <span>timer</span>,
}));

vi.mock("@/components/user/UsernameDisplay", () => ({
  default: ({ address }) => <span>{address}</span>,
}));

describe("MobileRaffleDetail - consolation prize calculation", () => {
  test("uses grandPrizeWei from winner summary instead of hardcoded 65%", () => {
    // Scenario: totalPrizePool = 1000 SOF (in wei), grandPrizeWei = 800 SOF
    // Consolation = (1000 - 800) / (10 - 1) = 200 / 9 ≈ 22.22 SOF per player
    // With hardcoded 65%: (1000 - 650) / 9 = 350 / 9 ≈ 38.88 SOF — WRONG
    const totalPrizePool = 1000n * 10n ** 18n;
    const grandPrizeWei = 800n * 10n ** 18n;

    useSeasonWinnerSummary.mockReturnValue({
      data: { grandPrizeWei, winnerAddress: "0xWinner" },
      isLoading: false,
    });

    render(
      <MobileRaffleDetail
        seasonId={1}
        seasonConfig={{ name: "Test Season", startTime: 0, endTime: 0 }}
        status={4}
        curveSupply={10n}
        maxSupply={100n}
        curveStep={{ price: 10n * 10n ** 18n }}
        allBondSteps={[]}
        localPosition={{ tickets: 1n, probBps: 1000 }}
        totalPrizePool={totalPrizePool}
        onBuy={vi.fn()}
        onSell={vi.fn()}
      />
    );

    // The consolation text should show ~22 SOF/player (200/9 = 22.22)
    // NOT ~38 SOF/player (350/9 = 38.88) which the hardcoded 65% would produce
    const consolationText = screen.getByText(/player/);
    // The value 22.22 rounds to "22.22" with formatSOF
    expect(consolationText.textContent).toContain("22.22");
    expect(consolationText.textContent).not.toContain("38");
  });

  test("falls back to 65% when no grandPrizeWei available", () => {
    // No winner summary → fallback to 65%
    // totalPrizePool = 1000, grand = 650, consolation = 350 / 9 ≈ 38.89
    const totalPrizePool = 1000n * 10n ** 18n;

    useSeasonWinnerSummary.mockReturnValue({
      data: null,
      isLoading: false,
    });

    render(
      <MobileRaffleDetail
        seasonId={2}
        seasonConfig={{ name: "Test Season 2", startTime: 0, endTime: 0 }}
        status={1}
        curveSupply={10n}
        maxSupply={100n}
        curveStep={{ price: 10n * 10n ** 18n }}
        allBondSteps={[]}
        localPosition={{ tickets: 1n, probBps: 1000 }}
        totalPrizePool={totalPrizePool}
        onBuy={vi.fn()}
        onSell={vi.fn()}
      />
    );

    const consolationText = screen.getByText(/player/);
    expect(consolationText.textContent).toContain("38.89");
  });
});
