import { render, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useContext } from "react";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({
    address: "0xabc",
    status: "connected",
  })),
}));

vi.mock("@wagmi/core", () => ({
  signMessage: vi.fn(),
}));

vi.mock("@/lib/wagmiConfig", () => ({ config: {} }));

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ walletType: "desktop-eoa" }),
}));

vi.mock("@/lib/apiBase", () => ({ API_BASE: "http://api.test" }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AppAuthProvider } from "@/context/AppAuthProvider";
import { AppAuthContext } from "@/context/AppAuthContext";

let capturedCtx = null;
const Probe = () => {
  capturedCtx = useContext(AppAuthContext);
  return null;
};

const makeFakeJwt = (claims) => {
  // header.payload.signature with payload = base64(JSON(claims))
  const body = btoa(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `h.${body}.s`;
};

beforeEach(() => {
  capturedCtx = null;
  mockFetch.mockReset();
  localStorage.clear();
});

describe("AppAuthProvider.linkFarcaster", () => {
  it("POSTs to /auth/link-farcaster with bearer and replaces jwt+user", async () => {
    // Seed with an authenticated wallet JWT
    const initialJwt = makeFakeJwt({ wallet_address: "0xabc" });
    localStorage.setItem("sof:auth_jwt", initialJwt);
    localStorage.setItem(
      "sof:auth_user",
      JSON.stringify({ address: "0xabc", fid: null, username: null }),
    );

    const refreshedJwt = makeFakeJwt({
      wallet_address: "0xabc",
      fid: 42,
      username: "alice",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: refreshedJwt,
        user: { address: "0xabc", fid: 42, username: "alice" },
      }),
    });

    render(
      <AppAuthProvider>
        <Probe />
      </AppAuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.status).toBe("authenticated"));
    expect(capturedCtx.user.fid).toBeNull();

    await act(async () => {
      await capturedCtx.linkFarcaster({
        message: "m",
        signature: "s",
        nonce: "n",
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/link-farcaster",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${initialJwt}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ message: "m", signature: "s", nonce: "n" }),
      }),
    );
    expect(capturedCtx.user.fid).toBe(42);
    expect(capturedCtx.user.username).toBe("alice");
    expect(capturedCtx.jwt).toBe(refreshedJwt);
  });

  it("sets status='error' and surfaces error on link failure", async () => {
    const initialJwt = makeFakeJwt({ wallet_address: "0xabc" });
    localStorage.setItem("sof:auth_jwt", initialJwt);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad sig" }),
    });

    render(
      <AppAuthProvider>
        <Probe />
      </AppAuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.status).toBe("authenticated"));

    await act(async () => {
      await capturedCtx.linkFarcaster({
        message: "m",
        signature: "s",
        nonce: "n",
      });
    });

    expect(capturedCtx.status).toBe("error");
    expect(capturedCtx.error).toMatch(/bad sig/);
  });
});

describe("AppAuthProvider.unlinkFarcaster", () => {
  it("POSTs to /auth/unlink-farcaster and clears fid/username on success", async () => {
    const initialJwt = makeFakeJwt({
      wallet_address: "0xabc",
      fid: 42,
      username: "alice",
    });
    localStorage.setItem("sof:auth_jwt", initialJwt);
    localStorage.setItem(
      "sof:auth_user",
      JSON.stringify({ address: "0xabc", fid: 42, username: "alice" }),
    );

    const refreshedJwt = makeFakeJwt({ wallet_address: "0xabc" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: refreshedJwt,
        user: { address: "0xabc", fid: null, username: null },
      }),
    });

    render(
      <AppAuthProvider>
        <Probe />
      </AppAuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.status).toBe("authenticated"));

    await act(async () => {
      await capturedCtx.unlinkFarcaster();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/unlink-farcaster",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${initialJwt}`,
        }),
      }),
    );
    expect(capturedCtx.user.fid).toBeNull();
    expect(capturedCtx.user.username).toBeNull();
  });
});
