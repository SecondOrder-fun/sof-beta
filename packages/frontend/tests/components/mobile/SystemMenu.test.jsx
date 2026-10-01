// tests/components/mobile/SystemMenu.test.jsx
// The mobile menu carries every page without a BottomNav tab, and its connect
// button opens the app's login entry point (MobileLoginSheet on mobile).
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SystemMenu from "@/components/mobile/SystemMenu";
import { useAllowlist } from "@/hooks/useAllowlist";
import { useAccount } from "wagmi";
import { ACCESS_LEVELS } from "@/config/accessLevels";

const openLoginModal = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, fallback) => (typeof fallback === "string" ? fallback : key.split(":").pop()),
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));
vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/hooks/useLoginModal", () => ({ useLoginModal: () => ({ openLoginModal }) }));
vi.mock("@/hooks/useAllowlist", () => ({ useAllowlist: vi.fn() }));

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

const renderMenu = ({ accessLevel = 0, onClose = vi.fn() } = {}) => {
  useAllowlist.mockReturnValue({ accessLevel });
  render(
    <MemoryRouter initialEntries={["/raffles"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SystemMenu isOpen onClose={onClose} profile={null} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose };
};

describe("SystemMenu", () => {
  beforeEach(() => {
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
  });

  it("links the pages that have no tab", () => {
    renderMenu();
    const hrefs = Object.fromEntries(
      ["launchToken", "createRaffle", "guides", "faq", "termsOfService", "privacyPolicy", "disclaimer"].map(
        (label) => [label, screen.getByRole("link", { name: label }).getAttribute("href")],
      ),
    );
    expect(hrefs).toEqual({
      launchToken: "/launch",
      createRaffle: "/create-season",
      guides: "/guides",
      faq: "/faq",
      termsOfService: "/terms",
      privacyPolicy: "/privacy",
      disclaimer: "/disclaimer",
    });
  });

  it("links the docs externally", () => {
    renderMenu();
    const docs = screen.getByRole("link", { name: "documentation" });
    expect(docs).toHaveAttribute("href", "https://secondorder-fun.gitbook.io/secondorder.fun/");
    expect(docs).toHaveAttribute("target", "_blank");
  });

  it("hides Admin from non-admins", () => {
    renderMenu({ accessLevel: ACCESS_LEVELS.BETA });
    expect(screen.queryByRole("link", { name: "admin" })).not.toBeInTheDocument();
  });

  it("shows Admin to admins", () => {
    renderMenu({ accessLevel: ACCESS_LEVELS.ADMIN });
    expect(screen.getByRole("link", { name: "admin" })).toHaveAttribute("href", "/admin");
  });

  it("navigates and closes when a link is followed", () => {
    const { onClose } = renderMenu();
    fireEvent.click(screen.getByRole("link", { name: "termsOfService" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/terms");
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the login entry point instead of picking a connector", () => {
    const { onClose } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "connectWallet" }));
    expect(openLoginModal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
