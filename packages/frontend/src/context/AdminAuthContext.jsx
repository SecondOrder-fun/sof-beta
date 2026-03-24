/**
 * AdminAuthContext — React context + provider for admin JWT authentication.
 *
 * Handles:
 *  - SIWE-style nonce → sign → verify flow via wallet signature
 *  - JWT persistence in sessionStorage
 *  - Expiry detection on mount
 */

import { createContext, useState, useCallback, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { useAccount } from "wagmi";
import { signMessage } from "@wagmi/core";
import { config } from "@/context/WagmiConfigProvider";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const STORAGE_KEY = "sof:admin_jwt";
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

export const AdminAuthContext = createContext(null);

/**
 * Decode a JWT payload without verification (client-side convenience).
 */
function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Check whether a JWT has expired (with 30s buffer).
 */
function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + 30_000;
}

export function AdminAuthProvider({ children }) {
  const { address } = useAccount();

  const [jwt, setJwt] = useState(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && !isTokenExpired(stored)) return stored;
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // SSR / restricted env
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Clear JWT when wallet disconnects or changes
  useEffect(() => {
    if (!address) {
      setJwt(null);
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
      return;
    }

    // If the stored JWT was issued for a different address, clear it
    if (jwt) {
      const payload = decodeJwtPayload(jwt);
      if (payload?.wallet_address && payload.wallet_address !== address.toLowerCase()) {
        setJwt(null);
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
      }
    }
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Full login flow: nonce → sign → verify → store JWT.
   */
  const login = useCallback(async () => {
    if (!address) {
      setError("Wallet not connected");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Request nonce
      const nonceRes = await fetch(`${API_BASE}/auth/nonce?address=${address}`);
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch nonce");
      }
      const { nonce } = await nonceRes.json();

      // 2. Sign message
      const message = `${SIGN_IN_MESSAGE_PREFIX}${nonce}`;
      const signature = await signMessage(config, { message });

      // 3. Verify signature and get JWT
      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, nonce }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || "Verification failed");
      }

      const { token } = await verifyRes.json();

      setJwt(token);
      try { sessionStorage.setItem(STORAGE_KEY, token); } catch { /* noop */ }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[AdminAuth] login error:", err);
      setError(err?.shortMessage || err?.message || "Login failed");
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  /**
   * Clear JWT and session.
   */
  const logout = useCallback(() => {
    setJwt(null);
    setError(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  /**
   * Returns auth headers for fetch requests.
   */
  const getAuthHeaders = useCallback(() => {
    if (!jwt) return {};
    return { Authorization: `Bearer ${jwt}` };
  }, [jwt]);

  const value = useMemo(
    () => ({
      jwt,
      isAuthenticated: Boolean(jwt) && !isTokenExpired(jwt),
      isLoading,
      error,
      login,
      logout,
      getAuthHeaders,
    }),
    [jwt, isLoading, error, login, logout, getAuthHeaders],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

AdminAuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
