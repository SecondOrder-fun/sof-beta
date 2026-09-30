// tests/components/App.activityTicker.test.jsx
// The desktop layout also serves mobile browsers, so its ticker goes compact
// there; the mini-app layout is always compact.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import App from "@/App";
import { usePlatform } from "@/hooks/usePlatform";

vi.mock("@/hooks/usePlatform", () => ({ usePlatform: vi.fn() }));
vi.mock("@/hooks/useSafeArea", () => ({ useSafeArea: () => ({ top: 0, bottom: 0 }) }));
vi.mock("@/context/UsernameContext", () => ({
  useUsernameContext: () => ({ showDialog: false, setShowDialog: vi.fn(), suggestedUsername: "" }),
}));
vi.mock("@/components/layout/ActivityTicker", () => ({
  default: ({ compact }) => <div data-testid="ticker" data-compact={compact ? "true" : "false"} />,
}));
// Everything else in the shell is out of scope here. (vi.hoisted: vi.mock
// factories run before the module body.)
const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock("@/components/layout/Header", stub);
vi.mock("@/components/layout/Footer", stub);
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/user/UsernameDialog", stub);
vi.mock("@/components/auth/LoginModal", stub);
vi.mock("@/components/auth/MobileLoginSheet", stub);
vi.mock("@/components/auth/FirstConnectBanner", stub);
vi.mock("@/components/auth/SignInRetryBanner", stub);
vi.mock("@/components/auth/SweepBanner", stub);
vi.mock("@/components/dev/ContractAddressValidator", () => ({ ContractAddressValidator: () => null }));
vi.mock("@/components/mobile/MobileHeader", stub);
vi.mock("@/components/mobile/BottomNav", stub);

const renderApp = (platform) => {
  usePlatform.mockReturnValue({ isMobile: false, isMobileBrowser: false, ...platform });
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
};

describe("App activity ticker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is full-width on a desktop browser", () => {
    renderApp({});
    expect(screen.getByTestId("ticker")).toHaveAttribute("data-compact", "false");
  });

  it("is compact on a mobile browser, which gets the desktop layout", () => {
    renderApp({ isMobileBrowser: true });
    expect(screen.getByTestId("ticker")).toHaveAttribute("data-compact", "true");
  });

  it("is compact in the mini-app layout", () => {
    renderApp({ isMobile: true });
    expect(screen.getByTestId("ticker")).toHaveAttribute("data-compact", "true");
  });
});
