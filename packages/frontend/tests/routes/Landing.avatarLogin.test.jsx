/*
  @vitest-environment jsdom
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const openLoginModalMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => ({
    isConnected: false,
  }),
}));

vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({
    openLoginModal: openLoginModalMock,
    closeLoginModal: vi.fn(),
    isLoginModalOpen: false,
  }),
}));

vi.mock("@/hooks/useFarcasterSDK", () => ({
  default: () => ({ isInFarcasterClient: false }),
}));

vi.mock("@/hooks/useUserProfile", () => ({
  useUserProfile: () => ({
    pfpUrl: null,
    displayName: null,
    username: null,
    fid: null,
    address: null,
    source: null,
  }),
}));

vi.mock("@/hooks/useAllowlist", () => ({
  useAllowlist: () => ({
    isAdmin: () => false,
  }),
}));

vi.mock("@/components/backgrounds/MeltyLines", () => ({
  default: () => null,
}));

vi.mock("@/components/farcaster/AddMiniAppButton", () => ({
  default: () => null,
}));

vi.mock("@/components/farcaster/LaunchAppButtons", () => ({
  default: () => null,
}));

vi.mock("@/components/landing/OpenAppButton", () => ({
  default: () => null,
}));

vi.mock("@/components/auth/FarcasterAuth", () => ({
  default: () => null,
}));

vi.mock("@/components/layout/StickyFooter", () => ({
  default: () => null,
}));

import Landing from "@/routes/Landing.jsx";

describe("Landing avatar login", () => {
  beforeEach(() => {
    openLoginModalMock.mockClear();
  });

  it("opens login modal when avatar is clicked while logged out", () => {
    render(<Landing />);

    const button = screen.getByRole("button", { name: "Log in" });
    fireEvent.click(button);

    expect(openLoginModalMock).toHaveBeenCalledTimes(1);
  });
});
