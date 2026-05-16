// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RolloverBanner from "@/components/curve/RolloverBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (!opts) return k;
      // Echo key with any string-able opts for assertion convenience.
      return `${k}:${JSON.stringify(opts)}`;
    },
  }),
}));

const ONE_SOF = 10n ** 18n;
const baseProps = {
  rolloverBalance: 455n * ONE_SOF,
  bonusBps: 600,
  bonusAmount: (sof) => (sof * 600n) / 10000n,
  sourceSeasonId: 1n,
  enabled: true,
  onEnabledChange: vi.fn(),
  rolloverAmount: 455n * ONE_SOF,
  onRolloverAmountChange: vi.fn(),
  estBuyWithFees: 455n * ONE_SOF,
  walletTopupSof: 0n,
  walletTopupTickets: 0n,
};

describe("RolloverBanner", () => {
  it("does not render the wallet-topup line when walletTopupTickets is zero", () => {
    render(<RolloverBanner {...baseProps} />);
    expect(screen.queryByText(/walletTopupLine/)).toBeNull();
    expect(screen.queryByText(/walletTopupTickets/)).toBeNull();
  });

  it("renders the wallet-topup line when walletTopupTickets > 0", () => {
    render(
      <RolloverBanner
        {...baseProps}
        walletTopupSof={518n * ONE_SOF}
        walletTopupTickets={518n}
      />
    );
    // i18n mock echoes the key; assert both new lines are present.
    expect(screen.getByText(/walletTopupLine/)).toBeInTheDocument();
    expect(screen.getByText(/walletTopupTickets/)).toBeInTheDocument();
  });

  it("hides the wallet-topup line when the banner is disabled", () => {
    render(
      <RolloverBanner
        {...baseProps}
        enabled={false}
        walletTopupSof={518n * ONE_SOF}
        walletTopupTickets={518n}
      />
    );
    expect(screen.queryByText(/walletTopupLine/)).toBeNull();
  });

  it("fires onEnabledChange when the switch is toggled", () => {
    const onEnabledChange = vi.fn();
    const { container } = render(
      <RolloverBanner {...baseProps} onEnabledChange={onEnabledChange} />
    );
    const sw =
      container.querySelector("[role='switch']") ||
      container.querySelector("button[type='button']");
    if (sw) fireEvent.click(sw);
    expect(onEnabledChange).toHaveBeenCalled();
  });
});
