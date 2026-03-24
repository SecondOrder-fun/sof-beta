// tests/components/swap/SwapWidget.placeholder.test.jsx
// TDD: Verify "Enter amount" placeholder is not clipped by pr-14 when Max button is hidden

import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SwapWidget from "@/components/swap/SwapWidget";

// Mock wagmi
vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: "0xUser", isConnected: true })),
  useChainId: vi.fn(() => 84532),
}));

// Mock swap hooks
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
  getContractAddresses: () => ({
    SOF: "0xSOF",
    USDC: "0xUSDC",
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "testnet",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => {
      const map = {
        title: "Swap",
        youPay: "You Pay",
        enterAmount: "Enter amount",
        youReceive: "You Receive",
        swap: "Swap",
        max: "Max",
      };
      return map[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock TokenSelector
vi.mock("@/components/swap/TokenSelector", () => ({
  default: ({ value }) => <div data-testid="token-selector">{value}</div>,
}));

describe("SwapWidget - placeholder padding", () => {
  test("input does NOT have pr-14 class when buying SOF (no Max button)", () => {
    render(<SwapWidget />);

    const input = screen.getByPlaceholderText("Enter amount");
    // When buying SOF (default), Max button is not shown, so pr-14 should NOT be present
    expect(input.className).not.toContain("pr-14");
  });
});
