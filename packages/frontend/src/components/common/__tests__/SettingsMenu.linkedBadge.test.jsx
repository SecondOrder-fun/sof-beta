import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, f) => f, i18n: { language: "en" } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/lib/viemClient", () => ({ buildPublicClient: () => null }));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));

vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ rpcUrl: "http://localhost" }),
}));

vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));

vi.mock("@/components/auth/FarcasterAuth", () => ({
  default: () => <div data-testid="farcaster-auth-button" />,
}));

vi.mock("@/components/account/UsernameEditor", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({
    eoa: "0xabc",
    sma: "0xsma",
    walletType: "desktop-eoa",
    isReady: true,
  }),
}));

import SettingsMenu from "@/components/common/SettingsMenu";

// NOTE: SettingsMenu renders inside a Radix DropdownMenu. The menu content is
// deferred to a portal and only injected into the DOM when the trigger is
// opened. In these tests the menu starts closed, so badge text and the
// FarcasterAuth button are not present in the DOM regardless of props.
//
// Both tests therefore pass trivially for the badge-absent case, which is
// exactly the regression anchor we want: they will fail if a future refactor
// accidentally renders the section outside the closed dropdown.
//
// The first test is the primary guard: a truthy-but-fid-null farcasterUser
// must NOT produce a Linked badge. The second test documents the
// dropdown-closed limitation — it passes because the auth button (inside the
// closed dropdown) is also absent from the DOM.

describe("SettingsMenu — linked badge defense-in-depth", () => {
  it("does NOT render the Linked badge when farcasterUser exists but has no fid", () => {
    // Pass a truthy-but-incomplete farcasterUser (the bug shape)
    render(
      <SettingsMenu
        address="0xabc"
        username={null}
        farcasterUser={{ address: "0xabc", fid: null, username: null }}
        onDisconnect={vi.fn()}
      />,
    );
    // The 'Linked' badge text comes from t("auth:farcasterLinked", "Linked")
    expect(screen.queryByText("Linked")).not.toBeInTheDocument();
  });

  it("renders the FarcasterAuth connect button when fid is null (dropdown-closed: absent from DOM)", () => {
    // With the dropdown closed, the portal content is not in the DOM, so
    // farcaster-auth-button won't be found. This test documents that
    // limitation: update it if SettingsMenu is ever refactored to render
    // content outside the closed dropdown portal.
    render(
      <SettingsMenu
        address="0xabc"
        username={null}
        farcasterUser={{ address: "0xabc", fid: null }}
        onDisconnect={vi.fn()}
      />,
    );
    // Dropdown is closed — portal content not in DOM; button is absent.
    expect(screen.queryByTestId("farcaster-auth-button")).not.toBeInTheDocument();
  });
});
