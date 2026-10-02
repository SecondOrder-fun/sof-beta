import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import * as wagmi from "wagmi";
import * as wagmiCore from "@wagmi/core";
import { AppAuthProvider } from "@/context/AppAuthProvider";
import { useAppAuth } from "@/hooks/useAppAuth";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  signMessage: vi.fn(),
}));

vi.mock("@/lib/wagmiConfig", () => ({
  config: { mocked: true },
}));

vi.mock("@/lib/apiBase", () => ({
  API_BASE: "http://test-api/api",
}));

// Helper: encode a fake JWT { wallet_address, exp } as a parseable token.
function makeJwt({ walletAddress, expSecondsFromNow = 3600 }) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      wallet_address: walletAddress,
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
      sma: "0x" + "b".repeat(40),
      is_admin: false,
    }),
  );
  return `${header}.${payload}.signature`;
}

// Test consumer that renders the auth state for assertions.
function StatusProbe() {
  const auth = useAppAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="jwt">{auth.jwt || "null"}</span>
      <span data-testid="address">{auth.user?.address || "null"}</span>
    </div>
  );
}

const EOA = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const EOA_LC = EOA.toLowerCase();
const SMA = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const OTHER_EOA = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";

// Default to a connected wallet. Individual tests override.
function mockConnected({ address = EOA } = {}) {
  wagmi.useAccount.mockReturnValue({
    address,
    isConnected: !!address,
    status: address ? "connected" : "disconnected",
    connector: { id: "metaMask" },
  });
}

function mockDisconnected() {
  wagmi.useAccount.mockReturnValue({
    address: undefined,
    isConnected: false,
    status: "disconnected",
    connector: undefined,
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AppAuthProvider", () => {
  describe("initial state + JWT rehydration", () => {
    it("starts with status='idle' and null jwt when disconnected", () => {
      mockDisconnected();
      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
      expect(screen.getByTestId("jwt")).toHaveTextContent("null");
    });

    it("rehydrates from localStorage when a valid JWT matches the connected address", () => {
      const token = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", token);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
      expect(screen.getByTestId("jwt")).toHaveTextContent(token);
      expect(screen.getByTestId("address")).toHaveTextContent(EOA_LC);
    });

    it("clears stale JWT (expired) on mount and triggers re-auth", async () => {
      const expired = makeJwt({ walletAddress: EOA_LC, expSecondsFromNow: -60 });
      localStorage.setItem("sof:auth_jwt", expired);
      mockConnected({ address: EOA });

      // Stub fetch + signMessage so the auto-fire reaches a clean state without hitting the network.
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc123" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: makeJwt({ walletAddress: EOA_LC }),
            user: { address: EOA_LC, sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      // Stale token cleared synchronously on mount
      await waitFor(() => {
        expect(localStorage.getItem("sof:auth_jwt")).not.toBe(expired);
      });
      // Then auto-fire kicks in
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );
    });

    it("clears legacy sof:admin_jwt and sof:farcaster_jwt keys on mount", () => {
      localStorage.setItem("sof:admin_jwt", "legacy-admin");
      localStorage.setItem("sof:farcaster_jwt", "legacy-farcaster");
      sessionStorage.setItem("sof:admin_jwt", "legacy-admin-session");
      sessionStorage.setItem("sof:farcaster_jwt", "legacy-farcaster-session");
      mockDisconnected();

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      expect(localStorage.getItem("sof:admin_jwt")).toBeNull();
      expect(localStorage.getItem("sof:farcaster_jwt")).toBeNull();
      expect(sessionStorage.getItem("sof:admin_jwt")).toBeNull();
      expect(sessionStorage.getItem("sof:farcaster_jwt")).toBeNull();
    });

    it("clears retired smart-account welcome dismissals (sof:welcomed:*) on mount", () => {
      localStorage.setItem(`sof:welcomed:${EOA_LC}`, "1");
      localStorage.setItem(`sof:welcomed:${OTHER_EOA.toLowerCase()}`, "1");
      localStorage.setItem("sof:unrelated", "keep");
      mockDisconnected();

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      expect(localStorage.getItem(`sof:welcomed:${EOA_LC}`)).toBeNull();
      expect(localStorage.getItem(`sof:welcomed:${OTHER_EOA.toLowerCase()}`)).toBeNull();
      expect(localStorage.getItem("sof:unrelated")).toBe("keep");
    });

    it("drops a legacy `sma` field from a rehydrated user", () => {
      localStorage.setItem("sof:auth_jwt", makeJwt({ walletAddress: EOA_LC }));
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      function UserProbe() {
        const { user } = useAppAuth();
        return <span data-testid="user">{JSON.stringify(user)}</span>;
      }
      render(
        <AppAuthProvider>
          <UserProbe />
        </AppAuthProvider>,
      );

      const user = JSON.parse(screen.getByTestId("user").textContent);
      expect(user).toEqual({ address: EOA_LC, isAdmin: false });
    });
  });

  describe("auto-fire on connect", () => {
    it("auto-fires signIn when a wallet connects without a cached JWT", async () => {
      const newToken = makeJwt({ walletAddress: EOA_LC });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc123" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: newToken,
            user: { address: EOA_LC, sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        "http://test-api/api/auth/nonce",
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        "http://test-api/api/auth/verify",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(EOA_LC),
        }),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBe(newToken);
    });

    it("does NOT auto-fire when cached JWT is valid for connected address", async () => {
      const cachedToken = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", cachedToken);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      global.fetch = vi.fn();
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      // Wait a tick to ensure no effect fires
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(wagmiCore.signMessage).not.toHaveBeenCalled();
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });
  });

  describe("wallet change", () => {
    it("clears state and re-auths when address changes mid-session", async () => {
      const tokenForOther = makeJwt({ walletAddress: OTHER_EOA.toLowerCase() });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "n1" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: tokenForOther,
            user: { address: OTHER_EOA.toLowerCase(), sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");

      // Pre-seed a JWT for the FIRST address.
      const firstToken = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", firstToken);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      const { rerender } = render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("address")).toHaveTextContent(EOA_LC),
      );

      // Simulate wallet change.
      mockConnected({ address: OTHER_EOA });
      rerender(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("address")).toHaveTextContent(
          OTHER_EOA.toLowerCase(),
        ),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBe(tokenForOther);
    });

    it("clears state on disconnect", async () => {
      const cachedToken = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", cachedToken);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      const { rerender } = render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );

      mockDisconnected();
      rerender(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("idle"),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBeNull();
    });

    it("resets status='error' to 'idle' when wallet disconnects after a failed sign-in", async () => {
      // Simulate a failed sign-in: nonce ok, verify 401.
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: "Invalid signature" }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      const { rerender } = render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );

      // User disconnects while error banner is showing.
      mockDisconnected();
      rerender(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("idle"),
      );
    });
  });

  describe("error states", () => {
    it("status='rejected' when signMessage throws UserRejectedRequestError", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) });
      const err = new Error("User rejected the request");
      err.name = "UserRejectedRequestError";
      wagmiCore.signMessage.mockRejectedValue(err);
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("rejected"),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBeNull();
    });

    it("status='error' when /verify returns 4xx/5xx", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: "Invalid signature" }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );
    });
  });

  describe("storage policy", () => {
    it("persists the JWT and the user, without a legacy `sma`, to localStorage", async () => {
      const token = makeJwt({ walletAddress: EOA_LC });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token,
            user: { address: EOA_LC, sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(localStorage.getItem("sof:auth_jwt")).toBe(token),
      );
      expect(JSON.parse(localStorage.getItem("sof:auth_user"))).toEqual({
        address: EOA_LC,
        isAdmin: false,
      });
    });

    it("does not send a walletType to /auth/verify", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: makeJwt({ walletAddress: EOA_LC }),
            user: { address: EOA_LC, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
      const body = JSON.parse(global.fetch.mock.calls[1][1].body);
      expect(body).toEqual({
        method: "wallet",
        address: EOA_LC,
        signature: "0xsig",
        nonce: "abc",
      });
    });

  });

  describe("getAuthHeaders", () => {
    it("returns Bearer header when authenticated, empty otherwise", async () => {
      function HeaderProbe() {
        const auth = useAppAuth();
        const headers = auth.getAuthHeaders();
        return (
          <span data-testid="headers">
            {headers.Authorization || "no-auth"}
          </span>
        );
      }

      const token = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", token);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <HeaderProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("headers")).toHaveTextContent(
          `Bearer ${token}`,
        ),
      );
    });
  });
});
