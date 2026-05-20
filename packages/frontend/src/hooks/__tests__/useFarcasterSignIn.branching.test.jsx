import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignIn = vi.fn();
const mockLinkFarcaster = vi.fn();
const mockUseAppAuth = vi.fn();

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => mockUseAppAuth(),
}));

const mockFetchNonce = vi.fn().mockResolvedValue("nonce-123");
vi.mock("@/hooks/useFarcaster", () => ({
  useFarcaster: () => ({ fetchNonce: mockFetchNonce }),
}));

const mockUseSignInConnect = vi.fn();
const mockUseSignInReconnect = vi.fn();
const mockUseSignInSignOut = vi.fn();
let mockChannelToken = null;
vi.mock("@farcaster/auth-kit", () => ({
  useSignIn: () => ({
    signOut: mockUseSignInSignOut,
    connect: mockUseSignInConnect,
    reconnect: mockUseSignInReconnect,
    channelToken: mockChannelToken,
    url: "https://example.com/qr",
    isError: false,
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, fallback) => fallback }),
}));

// Mock global fetch used by the relay poll
const originalFetch = global.fetch;

beforeEach(() => {
  mockSignIn.mockReset();
  mockLinkFarcaster.mockReset();
  mockUseAppAuth.mockReset();
  mockChannelToken = null;
  global.fetch = vi.fn((url) => {
    if (url.startsWith("https://relay.farcaster.xyz")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({
          state: "completed",
          message: "siwf-msg",
          signature: "0xsig",
        }),
      });
    }
    return originalFetch?.(url);
  });
});

describe("useFarcasterSignIn JWT branching", () => {
  it("calls linkFarcaster when a JWT exists", async () => {
    mockUseAppAuth.mockReturnValue({
      signIn: mockSignIn,
      linkFarcaster: mockLinkFarcaster,
      status: "authenticated",
      jwt: "existing-jwt",
    });

    const { useFarcasterSignIn } = await import("@/hooks/useFarcasterSignIn");
    mockChannelToken = "ch_token_1";
    renderHook(() => useFarcasterSignIn());

    await waitFor(() => {
      expect(mockLinkFarcaster).toHaveBeenCalledWith({
        message: "siwf-msg",
        signature: "0xsig",
        nonce: "nonce-123",
      });
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("calls signIn(method=farcaster) when no JWT exists", async () => {
    mockUseAppAuth.mockReturnValue({
      signIn: mockSignIn,
      linkFarcaster: mockLinkFarcaster,
      status: "idle",
      jwt: null,
    });

    const { useFarcasterSignIn } = await import("@/hooks/useFarcasterSignIn");
    mockChannelToken = "ch_token_2";
    renderHook(() => useFarcasterSignIn());

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        method: "farcaster",
        message: "siwf-msg",
        signature: "0xsig",
        nonce: "nonce-123",
      });
    });
    expect(mockLinkFarcaster).not.toHaveBeenCalled();
  });
});
