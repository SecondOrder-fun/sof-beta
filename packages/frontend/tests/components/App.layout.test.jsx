// tests/components/App.layout.test.jsx
// The app shell picks its layout from usePlatform().isMobile: phones and
// touch tablets get the mobile shell (compact ticker, bottom nav, the login
// sheet), everything else the desktop one (full ticker, login modal).
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
// Everything else in the shell is out of scope here; the pieces whose presence
// is asserted render a marker. (vi.hoisted: vi.mock factories run before the
// module body.)
const stub = vi.hoisted(() => () => ({ default: () => null }));
const marker = vi.hoisted(() => (id) => ({ default: () => <div data-testid={id} /> }));
vi.mock("@/components/layout/Header", () => marker("desktop-header"));
vi.mock("@/components/layout/Footer", stub);
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/user/UsernameDialog", stub);
vi.mock("@/components/auth/LoginModal", () => marker("login-modal"));
vi.mock("@/components/auth/MobileLoginSheet", () => marker("mobile-login-sheet"));
vi.mock("@/components/auth/FirstConnectBanner", stub);
vi.mock("@/components/auth/SignInRetryBanner", stub);
vi.mock("@/components/auth/SweepBanner", stub);
vi.mock("@/components/dev/ContractAddressValidator", () => ({ ContractAddressValidator: () => null }));
vi.mock("@/components/mobile/MobileHeader", () => marker("mobile-header"));
vi.mock("@/components/mobile/BottomNav", () => marker("bottom-nav"));

const renderApp = (platform, path = "/") => {
  usePlatform.mockReturnValue({ isMobile: false, ...platform });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};

describe("App shell", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("desktop layout", () => {
    it("has the full-width ticker", () => {
      renderApp({});
      expect(screen.getByTestId("ticker")).toHaveAttribute("data-compact", "false");
    });

    it("renders the header and the login modal, not the mobile pieces", () => {
      renderApp({});
      expect(screen.getByTestId("desktop-header")).toBeInTheDocument();
      expect(screen.getByTestId("login-modal")).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-login-sheet")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bottom-nav")).not.toBeInTheDocument();
    });

  });

  describe("mobile layout", () => {
    it("has the compact ticker", () => {
      renderApp({ isMobile: true });
      expect(screen.getByTestId("ticker")).toHaveAttribute("data-compact", "true");
    });

    it("renders the mobile header, bottom nav and login sheet", () => {
      renderApp({ isMobile: true });
      expect(screen.getByTestId("mobile-header")).toBeInTheDocument();
      expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-login-sheet")).toBeInTheDocument();
      expect(screen.queryByTestId("login-modal")).not.toBeInTheDocument();
      expect(screen.queryByTestId("desktop-header")).not.toBeInTheDocument();
    });

    it("pads pages that have no mobile variant", () => {
      renderApp({ isMobile: true }, "/terms");
      expect(screen.getByTestId("mobile-page-gutter")).toBeInTheDocument();
    });

    it.each(["/", "/raffles", "/raffles/3", "/markets/7", "/portfolio", "/leaderboard", "/create-season"])(
      "leaves %s full-bleed (its mobile view has its own gutters)",
      (path) => {
        renderApp({ isMobile: true }, path);
        expect(screen.queryByTestId("mobile-page-gutter")).not.toBeInTheDocument();
      },
    );
  });
});
