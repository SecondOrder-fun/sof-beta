import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppAuthContext } from "@/context/AppAuthProvider";
import SignInRetryBanner from "@/components/auth/SignInRetryBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

function withAuth(value, ui) {
  return (
    <AppAuthContext.Provider value={value}>{ui}</AppAuthContext.Provider>
  );
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

describe("SignInRetryBanner", () => {
  it.each([["authenticated"], ["idle"], ["signing"], ["verifying"]])(
    "is hidden when status=%s",
    (status) => {
      render(
        withAuth(
          { status, error: null, signIn: vi.fn() },
          <SignInRetryBanner />,
        ),
      );
      expect(screen.queryByTestId("signin-retry-banner")).not.toBeInTheDocument();
    },
  );

  it("renders rejected copy when status='rejected'", () => {
    render(
      withAuth(
        { status: "rejected", error: null, signIn: vi.fn() },
        <SignInRetryBanner />,
      ),
    );
    expect(screen.getByTestId("signin-retry-banner")).toBeInTheDocument();
    expect(screen.getByText("signInRetry.rejectedTitle")).toBeInTheDocument();
    expect(screen.getByText("signInRetry.rejectedBody")).toBeInTheDocument();
  });

  it("renders error copy when status='error'", () => {
    render(
      withAuth(
        { status: "error", error: "Network down", signIn: vi.fn() },
        <SignInRetryBanner />,
      ),
    );
    expect(screen.getByText("signInRetry.errorTitle")).toBeInTheDocument();
    // Body uses the error as the {{reason}} interpolation
    expect(
      screen.getByText(/signInRetry\.errorBody\|.*Network down/),
    ).toBeInTheDocument();
  });

  it("clicking the button calls signIn()", () => {
    const signIn = vi.fn();
    render(
      withAuth(
        { status: "rejected", error: null, signIn },
        <SignInRetryBanner />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /signInRetry.button/i }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
