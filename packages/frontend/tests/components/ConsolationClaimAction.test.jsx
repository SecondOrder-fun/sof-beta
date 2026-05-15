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

vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: vi.fn() }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const mockClaimToRollover = { mutate: vi.fn() };

vi.mock("@/hooks/useRollover", () => ({
  useRollover: vi.fn(),
}));

import { useRollover } from "@/hooks/useRollover";
import ConsolationClaimAction from "@/components/raffle/ConsolationClaimAction";

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/prop-types, react/display-name
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe("ConsolationClaimAction", () => {
  describe("no rollover available", () => {
    it("renders a single claim button that calls onClaimToWallet", () => {
      useRollover.mockReturnValue({
        hasClaimableRollover: false,
        bonusBps: 0,
        bonusAmount: () => 0n,
        claimToRollover: { mutate: vi.fn() },
      });

      const onClaimToWallet = vi.fn();
      render(
        wrap(
          React.createElement(ConsolationClaimAction, {
            seasonId: 1n,
            amount: 10n ** 18n,
            isPending: false,
            onClaimToWallet,
          })
        )
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);

      fireEvent.click(buttons[0]);
      expect(onClaimToWallet).toHaveBeenCalledWith({ seasonId: 1n });
    });
  });

  describe("rollover available", () => {
    it("shows bonus amount, rollover button, and wallet link", () => {
      useRollover.mockReturnValue({
        hasClaimableRollover: true,
        bonusBps: 600,
        bonusAmount: (a) => (a * 600n) / 10000n,
        claimToRollover: mockClaimToRollover,
      });

      const onClaimToWallet = vi.fn();
      render(
        wrap(
          React.createElement(ConsolationClaimAction, {
            seasonId: 1n,
            amount: 10n ** 18n,
            isPending: false,
            onClaimToWallet,
          })
        )
      );

      // Green box shows +0.06 SOF (6% of 1 SOF = 0.06 SOF)
      expect(screen.getByText(/\+0\.06 SOF/)).toBeTruthy();

      // Primary rollover button
      const rolloverBtn = screen.getByRole("button", { name: /raffle:rolloverAmount/i });
      fireEvent.click(rolloverBtn);
      expect(mockClaimToRollover.mutate).toHaveBeenCalledWith({ seasonId: 1n });

      // Secondary "claim to wallet instead" link
      const walletLink = screen.getByText("raffle:claimToWalletInstead");
      fireEvent.click(walletLink);
      expect(onClaimToWallet).toHaveBeenCalledWith({ seasonId: 1n });
    });
  });
});
