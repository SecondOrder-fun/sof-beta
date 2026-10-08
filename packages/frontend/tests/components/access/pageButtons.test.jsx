import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import MaintenancePage from "@/components/access/MaintenancePage";
import AccessDeniedPage from "@/components/access/AccessDeniedPage";
import ErrorPage from "@/components/common/ErrorPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue ?? key }),
}));

// These pages used <Button asChild><Link>, whose span wrapper misses the
// global button styles; they are plain Buttons that navigate on click.
const renderAt = (page) =>
  render(
    <MemoryRouter initialEntries={["/somewhere"]}>
      <Routes>
        <Route path="/somewhere" element={page} />
        <Route path="/" element={<p>home page</p>} />
        <Route path="/account" element={<p>account page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("access and error page buttons", () => {
  it("maintenance: returns home", () => {
    renderAt(<MaintenancePage />);
    fireEvent.click(screen.getByRole("button", { name: "return_home" }));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("access denied: opens the account", () => {
    renderAt(<AccessDeniedPage />);
    fireEvent.click(screen.getByRole("button", { name: "view_account" }));
    expect(screen.getByText("account page")).toBeInTheDocument();
  });

  it("access denied: returns home", () => {
    renderAt(<AccessDeniedPage />);
    fireEvent.click(screen.getByRole("button", { name: "return_home" }));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("error page: goes home", () => {
    renderAt(<ErrorPage error={{ message: "boom" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });
});
