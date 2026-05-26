// tests/components/swap/SwapWidget.ethBalance.test.jsx
// Issue #119: header surfaces native ETH balance alongside $SOF balance so
// users can see whether they have gas to transact.

import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SwapWidget from "@/components/swap/SwapWidget";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: "0xUser", isConnected: true })),
  useChainId: vi.fn(() => 84532),
  useBalance: vi.fn(() => ({
    data: { formatted: "1.2345", symbol: "ETH", value: 1234500000000000000n, decimals: 18 },
  })),
}));

vi.mock("@/hooks/swap/useSwapProvider", () => ({
  useSwapProvider: vi.fn(() => ({ exchangeAddress: "0xExchange", getQuote: vi.fn(), getDailyUsage: vi.fn() })),
}));

vi.mock("@/hooks/swap/useSwapTransaction", () => ({
  useSwapTransaction: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  })),
}));

vi.mock("@/hooks/useSOFToken", () => ({
  useSOFToken: vi.fn(() => ({ balance: "100", refetchBalance: vi.fn() })),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF: "0xSOF", USDC: "0xUSDC" }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "testnet",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, fallback) => fallback ?? key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/components/swap/TokenSelector", () => ({
  default: ({ value }) => <div data-testid="token-selector">{value}</div>,
}));

describe("SwapWidget - ETH balance header", () => {
  test("renders ETH balance from wagmi useBalance alongside the $SOF row", () => {
    render(<SwapWidget />);

    expect(screen.getByText("Your ETH balance:")).toBeInTheDocument();
    expect(screen.getByText("1.2345")).toBeInTheDocument();
    expect(screen.getByText("ETH")).toBeInTheDocument();
  });

  test("still shows the $SOF balance row", () => {
    render(<SwapWidget />);

    expect(screen.getByText("Your $SOF balance:")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});
