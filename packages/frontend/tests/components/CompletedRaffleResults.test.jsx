/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue || key, i18n: { language: "en" } }),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }) => React.createElement("div", { "data-testid": "card" }, children),
  CardContent: ({ children, className }) => React.createElement("div", { className }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant, className }) =>
    React.createElement("span", { "data-testid": "badge", "data-variant": variant, className }, children),
}));

vi.mock("@/components/user/UsernameDisplay", () => ({
  default: ({ address }) => React.createElement("span", { "data-testid": "username" }, address),
}));

vi.mock("@/hooks/useRollover", () => ({
  useRollover: vi.fn(),
}));

// ConsolationClaimAction (rendered by this component) mounts TransactionModal
// which calls useTransactionStatus → usePublicClient. The test has no
// WagmiProvider, so stub usePublicClient out — receipt polling isn't exercised
// here.
vi.mock("wagmi", () => ({
  usePublicClient: () => ({ waitForTransactionReceipt: vi.fn() }),
}));

import { useRollover } from "@/hooks/useRollover";
import CompletedRaffleResults from "@/components/raffle/CompletedRaffleResults";

const defaultConsolationStatus = {
  totalPoolWei: 200n,
  perLoserShareWei: 100n,
  viewerEligible: null,
  viewerClaimed: false,
  isLoading: false,
};

describe("CompletedRaffleResults", () => {
  beforeEach(() => {
    useRollover.mockReturnValue({
      hasClaimableRollover: false,
      bonusBps: 0,
      bonusAmount: () => 0n,
      claimToRollover: { mutate: vi.fn() },
    });
  });

  it("renders the cancelled message for seasonStatus 6", () => {
    render(
      React.createElement(CompletedRaffleResults, {
        winnerAddress: null,
        grandPrizeWei: 0n,
        consolationStatus: defaultConsolationStatus,
        seasonStatus: 6,
      })
    );
    expect(screen.getByText("seasonCancelled")).toBeTruthy();
  });

  it("shows the winner address when provided", () => {
    render(
      React.createElement(CompletedRaffleResults, {
        winnerAddress: "0xwinner",
        grandPrizeWei: 500n,
        consolationStatus: defaultConsolationStatus,
        seasonStatus: 5,
      })
    );
    expect(screen.getByTestId("username").textContent).toBe("0xwinner");
  });

  it("shows youClaimed badge when viewerClaimed is true", () => {
    render(
      React.createElement(CompletedRaffleResults, {
        winnerAddress: "0xwinner",
        grandPrizeWei: 0n,
        consolationStatus: {
          ...defaultConsolationStatus,
          viewerEligible: true,
          viewerClaimed: true,
        },
        seasonStatus: 5,
      })
    );
    const badges = screen.getAllByTestId("badge");
    const texts = badges.map((b) => b.textContent);
    expect(texts.some((t) => t.includes("youClaimed"))).toBe(true);
  });

  it("shows static youClaimable badge when eligible but no action props provided (back-compat)", () => {
    render(
      React.createElement(CompletedRaffleResults, {
        winnerAddress: "0xwinner",
        grandPrizeWei: 0n,
        consolationStatus: {
          ...defaultConsolationStatus,
          viewerEligible: true,
          viewerClaimed: false,
        },
        seasonStatus: 5,
        // intentionally omit seasonId, viewerClaimableAmount, onClaimToWallet
      })
    );
    const badges = screen.getAllByTestId("badge");
    const texts = badges.map((b) => b.textContent);
    expect(texts.some((t) => t.includes("youClaimable"))).toBe(true);
  });

  it("renders ConsolationClaimAction (plain claim button) when action props are provided", () => {
    const onClaimToWallet = vi.fn();
    render(
      React.createElement(CompletedRaffleResults, {
        winnerAddress: "0xabc",
        grandPrizeWei: 100n,
        consolationStatus: {
          totalPoolWei: 100n,
          perLoserShareWei: 50n,
          viewerEligible: true,
          viewerClaimed: false,
          isLoading: false,
        },
        seasonStatus: 5,
        seasonId: 1n,
        viewerClaimableAmount: 50n,
        onClaimToWallet,
      })
    );

    // Should render a button with "claimPrize" text (the plain variant from ConsolationClaimAction)
    const btn = screen.getByRole("button", { name: /raffle:claimPrize/i });
    expect(btn).toBeTruthy();

    // Clicking it should call onClaimToWallet with { seasonId: 1n }
    fireEvent.click(btn);
    expect(onClaimToWallet).toHaveBeenCalledWith({ seasonId: 1n });
  });
});
