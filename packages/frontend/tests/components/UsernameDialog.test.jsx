// tests/components/UsernameDialog.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";
import UsernameDialog from "@/components/user/UsernameDialog";
import * as usernameHooks from "@/hooks/useUsername";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const translations = {
        setUsername: "Set Username",
        usernameDialogDescription:
          "Choose a unique username to personalize your profile. You can change it later.",
        username: "Username",
        usernamePlaceholder: "Enter username",
        skipForNow: "Skip for now",
        error: "Error",
        success: "Success",
        usernameTooShort: "Username must be at least 3 characters",
        usernameTooLong: "Username must be 20 characters or less",
        usernameInvalidChars:
          "Username can only contain letters, numbers, and underscores",
        usernameAvailable: "Username is available!",
        usernameNotAvailable: "Username is not available",
        checkingAvailability: "Checking availability...",
        usernameSet: `Username set to ${options?.username || ""}`,
        "usernameError.USERNAME_TAKEN": "Username is already taken",
        "usernameError.UNKNOWN_ERROR": "An unknown error occurred",
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

// Mock toast
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("UsernameDialog", () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const Wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    Wrapper.displayName = "UsernameDialogTestWrapper";
    Wrapper.propTypes = {
      children: PropTypes.node.isRequired,
    };
    return Wrapper;
  };

  it("should render dialog when open", () => {
    const onOpenChange = vi.fn();

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    expect(
      screen.getByRole("heading", { name: "Set Username" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter username")).toBeInTheDocument();
  });

  it("should not render dialog when closed", () => {
    const onOpenChange = vi.fn();

    render(<UsernameDialog open={false} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    expect(screen.queryByText("Set Username")).not.toBeInTheDocument();
  });

  it("should show character counter", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    const input = screen.getByPlaceholderText("Enter username");

    await user.type(input, "alice");

    expect(screen.getByText("5/20")).toBeInTheDocument();
  });

  it("should show validation error for short username", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    const input = screen.getByPlaceholderText("Enter username");

    await user.type(input, "ab");

    expect(
      screen.getByText("Username must be at least 3 characters"),
    ).toBeInTheDocument();
  });

  it("should show validation error for invalid characters", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    const input = screen.getByPlaceholderText("Enter username");

    await user.type(input, "test@user");

    expect(
      screen.getByText(
        "Username can only contain letters, numbers, and underscores",
      ),
    ).toBeInTheDocument();
  });

  it("should call onOpenChange when skip button is clicked", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    const skipButton = screen.getByText("Skip for now");
    await user.click(skipButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("should disable submit button for invalid username", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    // Mock availability check to return not available
    vi.spyOn(usernameHooks, "useCheckUsername").mockReturnValue({
      data: { available: false, error: "USERNAME_TAKEN" },
      isLoading: false,
    });

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    const input = screen.getByPlaceholderText("Enter username");
    await user.type(input, "taken");

    const submitButton = screen.getByRole("button", { name: "Set Username" });
    expect(submitButton).toBeDisabled();
  });

  it("should enable submit button for valid available username", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    // Mock availability check to return available
    vi.spyOn(usernameHooks, "useCheckUsername").mockReturnValue({
      data: { available: true },
      isLoading: false,
    });

    render(<UsernameDialog open={true} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    const input = screen.getByPlaceholderText("Enter username");
    await user.type(input, "alice");

    await waitFor(() => {
      const submitButton = screen.getByRole("button", { name: "Set Username" });
      expect(submitButton).not.toBeDisabled();
    });
  });
});
