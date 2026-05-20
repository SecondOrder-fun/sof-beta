import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: vi.fn(),
}));

vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));

vi.mock("@/hooks/useUsername", () => ({
  useUsername: () => ({ data: null }),
}));

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: "0xsma", walletType: "desktop-eoa" }),
}));

vi.mock("@/hooks/useAllowlist", () => ({
  useAllowlist: () => ({ accessLevel: 1 }),
}));

vi.mock("@/hooks/useRouteAccess", () => ({
  useRouteAccess: () => ({ isDisabled: true, hasAccess: false }),
}));

// Capture the farcasterUser prop passed to SettingsMenu
const capturedProps = { farcasterUser: undefined };
vi.mock("@/components/common/SettingsMenu", () => ({
  default: (props) => {
    capturedProps.farcasterUser = props.farcasterUser;
    return <div data-testid="settings-menu" />;
  },
}));

vi.mock("@/components/auth/FarcasterAuth", () => ({
  default: () => <div data-testid="farcaster-auth" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, f) => f }),
}));

import { useAppAuth } from "@/hooks/useAppAuth";
import Header from "@/components/layout/Header";

const renderHeader = () =>
  render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );

describe("Header — farcasterUser prop", () => {
  it("passes null when backendUser has no fid", () => {
    vi.mocked(useAppAuth).mockReturnValue({
      user: { address: "0xabc", fid: null, username: null },
      status: "authenticated",
      signOut: vi.fn(),
    });
    capturedProps.farcasterUser = undefined;
    renderHeader();
    expect(screen.getByTestId("settings-menu")).toBeInTheDocument();
    expect(capturedProps.farcasterUser).toBeNull();
  });

  it("passes the backendUser when fid is present", () => {
    const user = { address: "0xabc", fid: 42, username: "alice" };
    vi.mocked(useAppAuth).mockReturnValue({
      user,
      status: "authenticated",
      signOut: vi.fn(),
    });
    capturedProps.farcasterUser = undefined;
    renderHeader();
    expect(capturedProps.farcasterUser).toEqual(user);
  });
});
