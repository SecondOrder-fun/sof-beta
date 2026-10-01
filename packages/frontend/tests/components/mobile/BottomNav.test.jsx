// tests/components/mobile/BottomNav.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import BottomNav from "@/components/mobile/BottomNav";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key.replace("navigation:", "") }),
}));
vi.mock("@/hooks/useSafeArea", () => ({ useSafeArea: () => ({ top: 0, bottom: 0 }) }));

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <BottomNav />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const tabNames = () => screen.getAllByRole("button").map((b) => b.textContent);
const activeTab = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-current") === "page")
    .map((b) => b.textContent);

describe("BottomNav", () => {
  it("has five tabs: Raffles, Markets, Tokens, Portfolio, Leaderboard", () => {
    renderAt("/raffles");
    expect(tabNames()).toEqual(["raffles", "markets", "tokens", "portfolio", "leaderboard"]);
  });

  it.each([
    ["/tokens", "tokens"],
    ["/tokens/0x1111111111111111111111111111111111111111", "tokens"],
    ["/launch", "tokens"],
    ["/raffles/4", "raffles"],
    ["/create-season", "raffles"],
    ["/markets", "markets"],
    ["/portfolio", "portfolio"],
    ["/users/0xabc", "leaderboard"],
  ])("marks %s as the %s tab", (path, tab) => {
    renderAt(path);
    expect(activeTab()).toEqual([tab]);
  });

  it.each(["/", "/terms", "/faq", "/admin"])("marks no tab on %s", (path) => {
    renderAt(path);
    expect(activeTab()).toEqual([]);
  });

  it("publishes its height for the shell and fixed bars, and clears it on unmount", () => {
    const { unmount } = renderAt("/raffles");
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--bottom-nav-height")).toMatch(/^\d+px$/);
    unmount();
    expect(root.style.getPropertyValue("--bottom-nav-height")).toBe("");
  });

  it("navigates to /tokens from the Tokens tab", () => {
    renderAt("/raffles");
    fireEvent.click(screen.getByRole("button", { name: "tokens" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tokens");
  });
});
