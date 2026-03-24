// tests/components/UsernameDisplay.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import PropTypes from "prop-types";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import * as usernameHooks from "@/hooks/useUsername";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => {
      const translations = {
        you: "You",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock wagmi
vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1234567890123456789012345678901234567890",
    isConnected: true,
  }),
}));

describe("UsernameDisplay", () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const Wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    );

    Wrapper.propTypes = {
      children: PropTypes.node,
    };

    Wrapper.displayName = "UsernameDisplayTestWrapper";

    return Wrapper;
  };

  it("should display username when available", () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: "alice",
      isLoading: false,
    });

    render(
      <UsernameDisplay address="0x1234567890123456789012345678901234567890" />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("should display formatted address when no username", () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: null,
      isLoading: false,
    });

    render(
      <UsernameDisplay address="0x1234567890123456789012345678901234567890" />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText("0x1234...7890")).toBeInTheDocument();
  });

  it('should show "You" badge when showBadge is true and is current user', () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: "alice",
      isLoading: false,
    });

    render(
      <UsernameDisplay
        address="0x1234567890123456789012345678901234567890"
        showBadge={true}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it('should not show "You" badge for different user', () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: "bob",
      isLoading: false,
    });

    render(
      <UsernameDisplay
        address="0x9999999999999999999999999999999999999999"
        showBadge={true}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("should render as link when linkTo is provided", () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: "alice",
      isLoading: false,
    });

    render(
      <UsernameDisplay
        address="0x1234567890123456789012345678901234567890"
        linkTo="/users/0x1234567890123456789012345678901234567890"
      />,
      { wrapper: createWrapper() },
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/users/0x1234567890123456789012345678901234567890",
    );
    expect(link).toHaveTextContent("alice");
  });

  it("should show formatted address during loading", () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(
      <UsernameDisplay address="0x1234567890123456789012345678901234567890" />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText("0x1234...7890")).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    vi.spyOn(usernameHooks, "useUsername").mockReturnValue({
      data: "alice",
      isLoading: false,
    });

    const { container } = render(
      <UsernameDisplay
        address="0x1234567890123456789012345678901234567890"
        className="custom-class"
      />,
      { wrapper: createWrapper() },
    );

    expect(container.firstChild).toHaveClass("custom-class");
  });
});
