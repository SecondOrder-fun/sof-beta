/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1234567890123456789012345678901234567890",
    isConnected: true,
  }),
  useDisconnect: () => ({
    disconnect: vi.fn(),
  }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: {
    Custom: ({ children }) =>
      children({
        account: { displayName: "0x1234...7890" },
        chain: { id: 8453 },
        openAccountModal: () => {},
        openConnectModal: () => {},
        mounted: true,
      }),
  },
}));

vi.mock("@/hooks/useUsername", () => ({
  useUsername: () => ({ data: null }),
}));

vi.mock("@/hooks/useAllowlist", () => ({
  useAllowlist: () => ({ accessLevel: 0 }),
}));

vi.mock("@/hooks/useRouteAccess", () => ({
  useRouteAccess: () => ({
    hasAccess: false,
    isDisabled: true,
    isLoading: false,
    isPublic: false,
    reason: "disabled",
    requiredLevel: 2,
    requiredGroups: [],
  }),
}));

vi.mock("@/hooks/useFarcaster", () => ({
  useFarcaster: () => ({
    isBackendAuthenticated: false,
    backendUser: null,
    logout: vi.fn(),
  }),
}));

vi.mock("@/components/auth/FarcasterAuth", () => ({
  default: () => null,
}));

vi.mock("@/components/common/LanguageToggle", () => ({
  default: () => null,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({
    openLoginModal: vi.fn(),
    closeLoginModal: vi.fn(),
    isLoginModalOpen: false,
  }),
}));

import Header from "@/components/layout/Header.jsx";

describe("Header prediction markets toggle", () => {
  it("does not render Prediction Markets nav when feature is disabled", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("navigation.predictionMarkets")).toBeNull();
  });
});
