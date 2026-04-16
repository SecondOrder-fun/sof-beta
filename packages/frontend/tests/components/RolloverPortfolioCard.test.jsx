/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue || key, i18n: { language: "en" } }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  // eslint-disable-next-line react/prop-types
  Link: ({ children, to }) => React.createElement("a", { href: to }, children),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1234", isConnected: true }),
  usePublicClient: () => ({}),
}));

vi.mock("@/hooks/useRollover", () => ({
  useRollover: () => ({
    rolloverBalance: 175000000000000000000n,
    cohortPhase: "active",
    bonusBps: 600,
    bonusPercent: "6%",
    nextSeasonId: 2n,
    refundRollover: { mutate: vi.fn(), isPending: false },
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

import RolloverPortfolioCard from "@/components/user/RolloverPortfolioCard";

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/prop-types, react/display-name
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe("RolloverPortfolioCard", () => {
  it("renders balance and phase badge", () => {
    render(wrap(React.createElement(RolloverPortfolioCard, { seasonId: 1 })));
    expect(screen.getByText("Rollover Balance")).toBeTruthy();
    expect(screen.getByText(/175/)).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("shows buy link when phase is active", () => {
    render(wrap(React.createElement(RolloverPortfolioCard, { seasonId: 1 })));
    expect(screen.getByText(/Buy Tickets/)).toBeTruthy();
  });
});
