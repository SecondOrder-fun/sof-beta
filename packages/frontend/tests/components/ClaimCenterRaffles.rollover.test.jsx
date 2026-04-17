/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue || key, i18n: { language: "en" } }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1234", isConnected: true }),
  usePublicClient: () => ({}),
}));

const mockClaimToRollover = { mutate: vi.fn(), isPending: false };
const mockClaimConsolation = { mutate: vi.fn(), isPending: false };

vi.mock("@/hooks/useRollover", () => ({
  useRollover: () => ({
    hasClaimableRollover: true,
    bonusPercent: "6%",
    bonusBps: 600,
    bonusAmount: (amt) => (amt * 600n) / 10000n,
    claimToRollover: mockClaimToRollover,
    isLoading: false,
  }),
}));

vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: vi.fn() }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import ClaimCenterRaffles from "@/components/infofi/claim/ClaimCenterRaffles";

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/prop-types, react/display-name
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe("ClaimCenterRaffles rollover", () => {
  const mockQuery = {
    isLoading: false,
    error: null,
    data: [
      {
        seasonId: 1n,
        type: "raffle-consolation",
        amount: 175000000000000000000n,
      },
    ],
  };

  it("shows rollover as primary action when cohort is open", () => {
    render(
      wrap(
        React.createElement(ClaimCenterRaffles, {
          raffleClaimsQuery: mockQuery,
          pendingClaims: new Set(),
          successfulClaims: new Set(),
          getClaimKey: (type, params) => `${type}-${params.seasonId}`,
          claimRaffleGrand: { mutate: vi.fn() },
          claimRaffleConsolation: mockClaimConsolation,
        })
      )
    );

    // Should show rollover UI elements
    expect(screen.getByText("raffle:rolloverToNextSeason")).toBeTruthy();
    expect(screen.getByText("raffle:claimToWalletInstead")).toBeTruthy();
  });

  it("calls claimToRollover when rollover button clicked", () => {
    render(
      wrap(
        React.createElement(ClaimCenterRaffles, {
          raffleClaimsQuery: mockQuery,
          pendingClaims: new Set(),
          successfulClaims: new Set(),
          getClaimKey: (type, params) => `${type}-${params.seasonId}`,
          claimRaffleGrand: { mutate: vi.fn() },
          claimRaffleConsolation: mockClaimConsolation,
        })
      )
    );

    // Find rollover button by text key (mock returns key when no defaultValue)
    const rolloverBtn = screen.getByRole("button", { name: /raffle:rolloverAmount/i });
    fireEvent.click(rolloverBtn);
    expect(mockClaimToRollover.mutate).toHaveBeenCalledWith({ seasonId: 1n });
  });

  it("calls claimRaffleConsolation when wallet link is clicked", () => {
    render(
      wrap(
        React.createElement(ClaimCenterRaffles, {
          raffleClaimsQuery: mockQuery,
          pendingClaims: new Set(),
          successfulClaims: new Set(),
          getClaimKey: (type, params) => `${type}-${params.seasonId}`,
          claimRaffleGrand: { mutate: vi.fn() },
          claimRaffleConsolation: mockClaimConsolation,
        })
      )
    );

    const walletLink = screen.getByText("raffle:claimToWalletInstead");
    fireEvent.click(walletLink);
    expect(mockClaimConsolation.mutate).toHaveBeenCalledWith({ seasonId: 1n });
  });

  it("shows regular claim button for grand prize even when rollover cohort is open", () => {
    const grandQuery = {
      isLoading: false,
      error: null,
      data: [
        {
          seasonId: 2n,
          type: "raffle-grand",
          amount: 500000000000000000000n,
        },
      ],
    };

    render(
      wrap(
        React.createElement(ClaimCenterRaffles, {
          raffleClaimsQuery: grandQuery,
          pendingClaims: new Set(),
          successfulClaims: new Set(),
          getClaimKey: (type, params) => `${type}-${params.seasonId}`,
          claimRaffleGrand: { mutate: vi.fn() },
          claimRaffleConsolation: mockClaimConsolation,
        })
      )
    );

    // Grand prize should NOT show rollover UI
    expect(screen.queryByText("raffle:rolloverToNextSeason")).toBeNull();
    // Should show regular claim button
    expect(screen.getByText("raffle:claimPrize")).toBeTruthy();
  });
});
