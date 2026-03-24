/**
 * FarcasterProvider — React context + provider for Farcaster SIWF authentication.
 *
 * Handles:
 *  - Auth-kit profile state from useProfile()
 *  - Backend JWT lifecycle: nonce → verify → store
 *  - JWT persistence in sessionStorage
 *  - Expiry detection on mount
 */

import { useEffect, useRef, useState, useContext, useCallback, useMemo } from "react";
import { useProfile } from "@farcaster/auth-kit";
import PropTypes from "prop-types";
import FarcasterContext from "./farcasterContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const STORAGE_KEY = "sof:farcaster_jwt";
const USER_STORAGE_KEY = "sof:farcaster_user";

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

const FarcasterProvider = ({ children }) => {
  const { isAuthenticated: isAuthKitAuthenticated, profile } = useProfile();

  // Backend JWT state
  const [backendJwt, setBackendJwt] = useState(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && !isTokenExpired(stored)) return stored;
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // SSR / restricted env
    }
    return null;
  });

  const [backendUser, setBackendUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem(USER_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // noop
    }
    return null;
  });

  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState(null);

  // Clear backend JWT when auth-kit transitions from authenticated → unauthenticated
  // (i.e., user explicitly signs out via auth-kit). We track the previous state
  // to avoid clearing on mount when auth-kit was never authenticated (our manual
  // relay polling bypasses auth-kit's internal state).
  const wasAuthKitAuthenticated = useRef(isAuthKitAuthenticated);
  useEffect(() => {
    if (wasAuthKitAuthenticated.current && !isAuthKitAuthenticated && backendJwt) {
      setBackendJwt(null);
      setBackendUser(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(USER_STORAGE_KEY);
      } catch {
        // noop
      }
    }
    wasAuthKitAuthenticated.current = isAuthKitAuthenticated;
  }, [isAuthKitAuthenticated, backendJwt]);

  /**
   * Fetch a nonce from the backend for SIWF message signing.
   * Returns the nonce string.
   */
  const fetchNonce = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/farcaster/nonce`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch nonce");
    }
    const { nonce } = await res.json();
    return nonce;
  }, []);

  /**
   * Verify SIWF credentials with the backend and store JWT.
   */
  const verifyWithBackend = useCallback(async ({ message, signature, nonce }) => {
    setIsVerifying(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/farcaster/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, nonce }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "SIWF verification failed");
      }

      const { token, user } = await res.json();

      setBackendJwt(token);
      setBackendUser(user);

      try {
        sessionStorage.setItem(STORAGE_KEY, token);
        sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      } catch {
        // noop
      }

      return { token, user };
    } catch (err) {
      setError(err?.message || "SIWF verification failed");
      throw err;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  /**
   * Clear all Farcaster auth state.
   */
  const logout = useCallback(() => {
    setBackendJwt(null);
    setBackendUser(null);
    setError(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // noop
    }
  }, []);

  /**
   * Returns auth headers for fetch requests.
   */
  const getAuthHeaders = useCallback(() => {
    if (!backendJwt) return {};
    return { Authorization: `Bearer ${backendJwt}` };
  }, [backendJwt]);

  const isBackendAuthenticated = Boolean(backendJwt) && !isTokenExpired(backendJwt);

  const value = useMemo(
    () => ({
      // Auth-kit state
      isAuthenticated: isAuthKitAuthenticated,
      profile: profile || null,
      // Backend auth state
      backendJwt,
      backendUser,
      isBackendAuthenticated,
      isVerifying,
      error,
      // Actions
      fetchNonce,
      verifyWithBackend,
      logout,
      getAuthHeaders,
    }),
    [
      isAuthKitAuthenticated,
      profile,
      backendJwt,
      backendUser,
      isBackendAuthenticated,
      isVerifying,
      error,
      fetchNonce,
      verifyWithBackend,
      logout,
      getAuthHeaders,
    ],
  );

  return (
    <FarcasterContext.Provider value={value}>
      {children}
    </FarcasterContext.Provider>
  );
};

FarcasterProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

// Hook to use Farcaster context
export const useFarcasterSDK = () => {
  const context = useContext(FarcasterContext);
  if (!context) {
    return { context: null };
  }
  return { context };
};

export { FarcasterProvider };
