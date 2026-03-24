// tests/components/airdrop/DailyClaimButton.test.jsx
// TDD: Verify DailyClaimButton resets success state and shows actual errors

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────────────

let airdropState = {};
const mockResetDailyState = vi.fn();
const mockClaimDaily = vi.fn();

vi.mock("@/hooks/useAirdrop", () => ({
  useAirdrop: () => airdropState,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true, address: "0xUser" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, params) => {
      const map = {
        dailyCooldown: "Next claim in",
        dailyDrip: "Daily drip",
        claiming: "Claiming...",
        claimed: "Claimed!",
        claimDaily: `Claim ${params?.amount || ""} $SOF`,
        claimError: "Claim failed",
      };
      return map[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

function defaultAirdropState(overrides = {}) {
  return {
    hasClaimed: true,
    dailyAmount: 100,
    canClaimDaily: true,
    timeUntilClaim: "",
    claimDaily: mockClaimDaily,
    claimDailyState: {
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    },
    resetDailyState: mockResetDailyState,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  airdropState = defaultAirdropState();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("DailyClaimButton", () => {
  test("renders claim button when canClaimDaily is true", async () => {
    const { default: DailyClaimButton } = await import(
      "@/components/airdrop/DailyClaimButton"
    );

    render(<DailyClaimButton />);
    expect(screen.getByRole("button", { name: /claim/i })).toBeInTheDocument();
  });

  test("button is NOT permanently disabled after successful claim", async () => {
    // After a successful claim, the button should eventually become re-enabled
    // (once cooldown elapses). It should NOT stay disabled forever because
    // isSuccess was never reset.
    airdropState = defaultAirdropState({
      claimDailyState: {
        isPending: false,
        isSuccess: true,
        isError: false,
        error: null,
      },
    });

    const { default: DailyClaimButton } = await import(
      "@/components/airdrop/DailyClaimButton"
    );

    const { rerender } = render(<DailyClaimButton />);

    // Now simulate the state resetting (as the component should trigger)
    airdropState = defaultAirdropState({
      canClaimDaily: true,
      claimDailyState: {
        isPending: false,
        isSuccess: false,
        isError: false,
        error: null,
      },
    });

    rerender(<DailyClaimButton />);

    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
  });

  test("calls resetDailyState after successful claim", async () => {
    // The component should call resetDailyState so that isSuccess doesn't
    // permanently disable the button
    airdropState = defaultAirdropState({
      claimDailyState: {
        isPending: false,
        isSuccess: true,
        isError: false,
        error: null,
      },
    });

    const { default: DailyClaimButton } = await import(
      "@/components/airdrop/DailyClaimButton"
    );

    await act(async () => {
      render(<DailyClaimButton />);
    });

    // Wait for the auto-reset effect to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 4000));
    });

    expect(mockResetDailyState).toHaveBeenCalled();
  });

  test("shows actual error message, not just generic key", async () => {
    airdropState = defaultAirdropState({
      claimDailyState: {
        isPending: false,
        isSuccess: false,
        isError: true,
        error: "Cooldown not elapsed",
      },
    });

    const { default: DailyClaimButton } = await import(
      "@/components/airdrop/DailyClaimButton"
    );

    render(<DailyClaimButton />);

    // Should show the actual error message somewhere in the component
    expect(screen.getByText(/cooldown not elapsed/i)).toBeInTheDocument();
  });

  test("does not render when user has not completed initial claim", async () => {
    airdropState = defaultAirdropState({ hasClaimed: false });

    const { default: DailyClaimButton } = await import(
      "@/components/airdrop/DailyClaimButton"
    );

    const { container } = render(<DailyClaimButton />);
    expect(container.innerHTML).toBe("");
  });
});
