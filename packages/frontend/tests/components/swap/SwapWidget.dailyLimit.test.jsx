// tests/components/swap/SwapWidget.dailyLimit.test.jsx
// Regression: SOFExchange.getDailyUsage() returns `type(uint256).max` for
// `remaining` when no daily sell limit is set. The UI used to render that
// as ~1.16e59 $SOF; it should hide the panel entirely.

import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SwapWidget from "@/components/swap/SwapWidget";

const MAX_UINT256 = (2n ** 256n) - 1n;

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: "0xUser", isConnected: true })),
  useChainId: vi.fn(() => 84532),
  useBalance: vi.fn(() => ({ data: undefined })),
}));

const getDailyUsageMock = vi.fn();

vi.mock("@/hooks/swap/useSwapProvider", () => ({
  useSwapProvider: vi.fn(() => ({
    exchangeAddress: "0xExchange",
    getQuote: vi.fn(),
    getDailyUsage: getDailyUsageMock,
  })),
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
  // SOF address matches the default `tokenIn` once the user toggles direction;
  // here we hard-code so the SwapWidget defaults to selling-SOF mode for
  // these tests (which is when the daily-limit panel renders).
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

// TokenSelector mock: emit an onChange-callable selector so we can flip to
// "sell SOF" mode. Since the panel only renders when isSellingSOF is true,
// the test relies on the default tokenIn being SOF.
vi.mock("@/components/swap/TokenSelector", () => ({
  default: ({ value, onChange }) => (
    <button
      data-testid="token-selector"
      onClick={() => onChange("0xSOF")}
    >
      {value}
    </button>
  ),
}));

describe("SwapWidget - daily sell limit panel", () => {
  test("hides the daily limit panel when contract reports type(uint256).max remaining", async () => {
    getDailyUsageMock.mockResolvedValue({ used: 0n, remaining: MAX_UINT256 });

    const { getByTestId } = render(<SwapWidget />);
    // Flip to selling-SOF so the daily-usage effect runs.
    fireEvent.click(getByTestId("token-selector"));

    await waitFor(() => expect(getDailyUsageMock).toHaveBeenCalled());

    expect(screen.queryByText("dailyLimit")).not.toBeInTheDocument();
    expect(screen.queryByText(/^remaining$/i)).not.toBeInTheDocument();
  });

  test("shows the daily limit panel with formatted remaining when a real limit is set", async () => {
    // 5000 $SOF remaining (5000 * 1e18 wei).
    getDailyUsageMock.mockResolvedValue({
      used: 0n,
      remaining: 5000n * 10n ** 18n,
    });

    const { getByTestId } = render(<SwapWidget />);
    fireEvent.click(getByTestId("token-selector"));

    await waitFor(() =>
      expect(screen.getByText(/5,000\s*\$SOF/)).toBeInTheDocument()
    );
  });
});
