// tests/components/FirstConnectBanner.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as raffleAccountHook from "@/hooks/useRaffleAccount";
import FirstConnectBanner from "@/components/auth/FirstConnectBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, vars) => {
      if (!vars) return key;
      return `${key}|${JSON.stringify(vars)}`;
    },
    i18n: { language: "en" },
  }),
}));

const EOA = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const SMA = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";

describe("FirstConnectBanner", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders for desktop-EOA when no dismissal flag is set", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      eoa: EOA,
      sma: SMA,
      walletType: "desktop-eoa",
      isReady: true,
    });

    render(<FirstConnectBanner />);

    expect(screen.getByTestId("first-connect-banner")).toBeInTheDocument();
    expect(screen.getByText("firstConnect.title")).toBeInTheDocument();
  });

  it("does not render when dismissal flag is set for that EOA", () => {
    localStorage.setItem(`sof:welcomed:${EOA.toLowerCase()}`, "1");
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      eoa: EOA,
      sma: SMA,
      walletType: "desktop-eoa",
      isReady: true,
    });

    render(<FirstConnectBanner />);

    expect(screen.queryByTestId("first-connect-banner")).not.toBeInTheDocument();
  });

  it("does not render for coinbase-smart wallets", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      eoa: EOA,
      sma: EOA,
      walletType: "coinbase-smart",
      isReady: true,
    });

    render(<FirstConnectBanner />);

    expect(screen.queryByTestId("first-connect-banner")).not.toBeInTheDocument();
  });

  it("does not render before isReady", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      eoa: EOA,
      sma: undefined,
      walletType: "desktop-eoa",
      isReady: false,
    });

    render(<FirstConnectBanner />);

    expect(screen.queryByTestId("first-connect-banner")).not.toBeInTheDocument();
  });

  it("dismiss button writes the flag and hides the banner", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      eoa: EOA,
      sma: SMA,
      walletType: "desktop-eoa",
      isReady: true,
    });

    render(<FirstConnectBanner />);

    const button = screen.getByRole("button", { name: /firstConnect.dismiss/i });
    fireEvent.click(button);

    expect(localStorage.getItem(`sof:welcomed:${EOA.toLowerCase()}`)).toBe("1");
    expect(screen.queryByTestId("first-connect-banner")).not.toBeInTheDocument();
  });
});
