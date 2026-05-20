import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/hooks/useFarcaster", () => ({
  useFarcaster: () => ({ profile: null }),
}));

const mockUseAppAuth = vi.fn();
vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => mockUseAppAuth(),
}));

const mockHandleSignInClick = vi.fn();
const mockHandleCancel = vi.fn();
const mockSiwfSignOut = vi.fn();
vi.mock("@/hooks/useFarcasterSignIn", () => ({
  useFarcasterSignIn: () => ({
    handleSignInClick: mockHandleSignInClick,
    handleCancel: mockHandleCancel,
    signOut: mockSiwfSignOut,
    showQrView: false,
    url: null,
    isLoading: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, f) => f }),
}));

vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null }));

import FarcasterAuth from "@/components/auth/FarcasterAuth";

describe("FarcasterAuth gating", () => {
  it("shows the Sign in with Farcaster button when fid is null even if authenticated", () => {
    mockUseAppAuth.mockReturnValue({
      user: { address: "0xabc", fid: null, username: null },
      status: "authenticated",
      signOut: vi.fn(),
      unlinkFarcaster: vi.fn(),
    });
    render(<FarcasterAuth />);
    expect(screen.getByText("Sign in with Farcaster")).toBeInTheDocument();
  });

  it("shows the profile view when fid is present", () => {
    mockUseAppAuth.mockReturnValue({
      user: { address: "0xabc", fid: 42, username: "alice" },
      status: "authenticated",
      signOut: vi.fn(),
      unlinkFarcaster: vi.fn(),
    });
    render(<FarcasterAuth />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.queryByText("Sign in with Farcaster")).not.toBeInTheDocument();
  });

  it("calls unlinkFarcaster (not appAuthSignOut) when Sign Out is clicked in profile view", () => {
    const unlinkFarcaster = vi.fn();
    const appAuthSignOut = vi.fn();
    mockUseAppAuth.mockReturnValue({
      user: { address: "0xabc", fid: 42, username: "alice" },
      status: "authenticated",
      signOut: appAuthSignOut,
      unlinkFarcaster,
    });
    render(<FarcasterAuth />);

    fireEvent.click(screen.getByText("Sign Out"));

    expect(unlinkFarcaster).toHaveBeenCalled();
    expect(appAuthSignOut).not.toHaveBeenCalled();
  });
});
