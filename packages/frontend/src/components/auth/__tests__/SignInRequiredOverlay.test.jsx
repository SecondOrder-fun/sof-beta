import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppAuthContext } from "@/context/AppAuthContext";
import SignInRequiredOverlay from "../SignInRequiredOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (key === "signInRetry.rejectedTitle") return "Sign-in declined";
      if (key === "signInRetry.errorTitle") return "Sign-in failed";
      if (key === "signInRetry.rejectedBody") return "Manual sign-in needed";
      if (key === "signInRetry.errorBody")
        return `Error: ${opts?.reason ?? ""}`;
      if (key === "signInRetry.button") return "Try again";
      return key;
    },
  }),
}));

const renderWithAuth = (ctx) =>
  render(
    <AppAuthContext.Provider value={ctx}>
      <SignInRequiredOverlay />
    </AppAuthContext.Provider>,
  );

describe("SignInRequiredOverlay", () => {
  it("renders nothing when authenticated", () => {
    renderWithAuth({
      status: "authenticated",
      error: null,
      signIn: vi.fn(),
    });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing during signing", () => {
    renderWithAuth({ status: "signing", error: null, signIn: vi.fn() });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when idle", () => {
    renderWithAuth({ status: "idle", error: null, signIn: vi.fn() });
    expect(
      screen.queryByTestId("signin-required-overlay"),
    ).not.toBeInTheDocument();
  });

  it("renders rejection copy when status is rejected", () => {
    renderWithAuth({ status: "rejected", error: null, signIn: vi.fn() });
    expect(screen.getByText("Sign-in declined")).toBeInTheDocument();
    expect(screen.getByText("Manual sign-in needed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("renders error copy with reason when status is error", () => {
    renderWithAuth({
      status: "error",
      error: "boom",
      signIn: vi.fn(),
    });
    expect(screen.getByText("Sign-in failed")).toBeInTheDocument();
    expect(screen.getByText("Error: boom")).toBeInTheDocument();
  });

  it("invokes signIn when the button is clicked", () => {
    const signIn = vi.fn();
    renderWithAuth({ status: "rejected", error: null, signIn });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
