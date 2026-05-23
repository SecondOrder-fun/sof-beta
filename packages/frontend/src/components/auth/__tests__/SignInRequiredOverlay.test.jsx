import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppAuthContext } from "@/context/AppAuthContext";
import SignInRequiredOverlay from "../SignInRequiredOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      const map = {
        "signInRetry.rejectedTitle": "Sign-in declined",
        "signInRetry.errorTitle": "Sign-in failed",
        "signInRetry.rejectedBody": "Retry sign-in to continue",
        "signInRetry.button": "Try again",
        "signInRequired.title": "Sign in to continue",
        "signInRequired.body": "Sign a one-time message",
        "signInRequired.button": "Sign in",
        "signInRequired.signingButton": "Signing in",
      };
      if (key === "signInRetry.errorBody") return `Error: ${opts?.reason ?? ""}`;
      return map[key] ?? key;
    },
  }),
}));

// Default: mock useAccount to return a fully-connected address. Individual
// tests override via vi.mocked(useAccount).mockReturnValueOnce(...).
vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: "0xabc", status: "connected" })),
}));

// Default: desktop-eoa wallet. Farcaster-miniapp gate test overrides per-call.
vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: vi.fn(() => ({ walletType: "desktop-eoa" })),
}));

import { useAccount } from "wagmi";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";

const renderWithAuth = (ctx) =>
  render(
    <AppAuthContext.Provider value={ctx}>
      <SignInRequiredOverlay />
    </AppAuthContext.Provider>,
  );

describe("SignInRequiredOverlay", () => {
  it("renders nothing when authenticated", () => {
    renderWithAuth({ status: "authenticated", error: null, signIn: vi.fn() });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when no wallet address is connected", () => {
    vi.mocked(useAccount).mockReturnValueOnce({
      address: undefined,
      status: "disconnected",
    });
    renderWithAuth({ status: "rejected", error: null, signIn: vi.fn() });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing during wagmi reconnecting hydration", () => {
    // address is truthy during 'reconnecting' but the connector is dehydrated;
    // signMessage would throw, so the overlay must stay hidden.
    vi.mocked(useAccount).mockReturnValueOnce({
      address: "0xabc",
      status: "reconnecting",
    });
    renderWithAuth({ status: "idle", error: null, signIn: vi.fn() });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when AppAuthContext is missing", () => {
    render(<SignInRequiredOverlay />);
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing for Farcaster MiniApp users (walletType=farcaster-miniapp)", () => {
    // Farcaster MiniApp owns its own sign-in surface (FarcasterAuth / SIWF
    // relay). Routing those users through the overlay would send raw SIWE
    // through the Farcaster connector and bypass the intended SIWF flow.
    vi.mocked(useRaffleAccount).mockReturnValueOnce({
      walletType: "farcaster-miniapp",
    });
    renderWithAuth({ status: "idle", error: null, signIn: vi.fn() });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("shows generic 'Sign in' CTA when status is idle", () => {
    renderWithAuth({ status: "idle", error: null, signIn: vi.fn() });
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("shows disabled 'Signing in' button while signing", () => {
    renderWithAuth({ status: "signing", error: null, signIn: vi.fn() });
    const btn = screen.getByRole("button", { name: "Signing in" });
    expect(btn).toBeDisabled();
  });

  it("shows disabled 'Signing in' button while verifying", () => {
    renderWithAuth({ status: "verifying", error: null, signIn: vi.fn() });
    expect(screen.getByRole("button", { name: "Signing in" })).toBeDisabled();
  });

  it("renders rejection copy when status is rejected", () => {
    renderWithAuth({ status: "rejected", error: null, signIn: vi.fn() });
    expect(screen.getByText("Sign-in declined")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("renders error copy with reason when status is error", () => {
    renderWithAuth({ status: "error", error: "boom", signIn: vi.fn() });
    expect(screen.getByText("Sign-in failed")).toBeInTheDocument();
    expect(screen.getByText("Error: boom")).toBeInTheDocument();
  });

  it("invokes signIn when the active button is clicked", () => {
    const signIn = vi.fn();
    renderWithAuth({ status: "rejected", error: null, signIn });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
