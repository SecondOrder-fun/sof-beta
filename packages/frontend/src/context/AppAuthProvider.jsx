/**
 * AppAuthProvider — global JWT lifecycle.
 *
 * Auto-fires SIWE on connect for desktop-EOA and Coinbase Smart Wallet
 * users when no valid cached JWT exists for the connected address.
 * Backend /api/auth/verify response populates user.sma + user.isAdmin
 * via ensureSmartAccount + ensureAdminFlag.
 *
 * Replaces AdminAuthContext (deleted) and the JWT half of FarcasterProvider
 * (kept for auth-kit profile state only).
 *
 * Storage:
 *  - desktop-eoa, coinbase-smart → localStorage (sof:auth_jwt + sof:auth_user)
 *  - farcaster-miniapp           → in-memory only
 *
 * See spec: docs/superpowers/specs/2026-05-07-universal-siwe-design.md
 */

import {
  createContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import PropTypes from "prop-types";
import { useAccount } from "wagmi";
import { signMessage } from "@wagmi/core";
import { config } from "@/lib/wagmiConfig";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { API_BASE } from "@/lib/apiBase";

const STORAGE_JWT_KEY = "sof:auth_jwt";
const STORAGE_USER_KEY = "sof:auth_user";
const LEGACY_KEYS = ["sof:admin_jwt", "sof:farcaster_jwt", "sof:farcaster_user"];
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

// Wallet types whose JWT should persist across tab/restart.
const PERSIST_WALLET_TYPES = new Set(["desktop-eoa", "coinbase-smart"]);
// Wallet types that auto-fire SIWE on connect.
const AUTO_FIRE_WALLET_TYPES = new Set(["desktop-eoa", "coinbase-smart"]);

export const AppAuthContext = createContext(null);

function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + 30_000;
}

function clearLegacyKeys() {
  for (const key of LEGACY_KEYS) {
    try { localStorage.removeItem(key); } catch { /* noop */ }
    try { sessionStorage.removeItem(key); } catch { /* noop */ }
  }
}

function readPersistedAuth(currentAddressLc) {
  try {
    const token = localStorage.getItem(STORAGE_JWT_KEY);
    if (!token || isTokenExpired(token)) {
      localStorage.removeItem(STORAGE_JWT_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      return null;
    }
    const payload = decodeJwtPayload(token);
    if (!payload?.wallet_address) {
      localStorage.removeItem(STORAGE_JWT_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      return null;
    }
    if (currentAddressLc && payload.wallet_address !== currentAddressLc) {
      localStorage.removeItem(STORAGE_JWT_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      return null;
    }
    let user = null;
    try {
      const raw = localStorage.getItem(STORAGE_USER_KEY);
      user = raw ? JSON.parse(raw) : null;
    } catch { /* noop */ }
    return { token, user };
  } catch {
    return null;
  }
}

export function AppAuthProvider({ children }) {
  // wagmi v2 `status` is one of 'connected' | 'reconnecting' | 'connecting' |
  // 'disconnected'. We gate auto-fire on the explicit 'connected' state because
  // signMessage walks config.state.connections.get(state.current).connector and
  // calls .getChainId() — during reconnecting hydration the connector reference
  // is still the dehydrated shape (no class methods), and signMessage throws
  // "connection.connector.getChainId is not a function". `isConnected` flips
  // true during reconnecting too; `status === 'connected'` only when the
  // connector instance is fully restored.
  const { address, status: walletStatus } = useAccount();
  const isFullyConnected = walletStatus === "connected";
  const { walletType } = useRaffleAccount();

  // Mount: clear legacy keys exactly once.
  const cleanedLegacyOnce = useRef(false);
  if (!cleanedLegacyOnce.current) {
    cleanedLegacyOnce.current = true;
    clearLegacyKeys();
  }

  const addressLc = address ? address.toLowerCase() : null;

  // Initial state: rehydrate if a valid JWT exists for the connected address.
  const [{ jwt, user }, setAuth] = useState(() => {
    if (!addressLc) return { jwt: null, user: null };
    const persisted = readPersistedAuth(addressLc);
    return persisted
      ? { jwt: persisted.token, user: persisted.user }
      : { jwt: null, user: null };
  });

  const [status, setStatus] = useState(jwt ? "authenticated" : "idle");
  const [error, setError] = useState(null);

  // Track in-flight signIn so wallet-change re-fires don't double up.
  const inflightRef = useRef(false);

  const persist = useCallback((token, userObj) => {
    if (!walletType || PERSIST_WALLET_TYPES.has(walletType)) {
      try {
        localStorage.setItem(STORAGE_JWT_KEY, token);
        if (userObj) localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(userObj));
      } catch { /* noop */ }
    }
  }, [walletType]);

  const clearStorage = useCallback(() => {
    try { localStorage.removeItem(STORAGE_JWT_KEY); } catch { /* noop */ }
    try { localStorage.removeItem(STORAGE_USER_KEY); } catch { /* noop */ }
  }, []);

  const signIn = useCallback(async (opts = { method: "wallet" }) => {
    if (inflightRef.current) return;
    if (!addressLc && opts.method !== "farcaster") {
      setError("Wallet not connected");
      setStatus("error");
      return;
    }

    inflightRef.current = true;
    setError(null);
    setStatus("signing");

    try {
      let body;
      if (opts.method === "farcaster") {
        const { message, signature, nonce } = opts;
        body = JSON.stringify({ method: "farcaster", message, signature, nonce });
      } else {
        // Wallet path — fetch nonce, sign, verify.
        const nonceRes = await fetch(`${API_BASE}/auth/nonce`);
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}));
          throw new Error(data.error || "Failed to fetch nonce");
        }
        const { nonce } = await nonceRes.json();

        const message = `${SIGN_IN_MESSAGE_PREFIX}${nonce}`;
        let signature;
        try {
          signature = await signMessage(config, { message });
        } catch (err) {
          if (
            err?.name === "UserRejectedRequestError" ||
            String(err?.message || "").includes("User rejected")
          ) {
            setStatus("rejected");
            setError("User rejected sign-in");
            return;
          }
          throw err;
        }

        setStatus("verifying");
        body = JSON.stringify({
          method: "wallet",
          address: addressLc,
          signature,
          nonce,
        });
      }

      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || `Verification failed (${verifyRes.status})`);
      }

      const { token, user: userObj } = await verifyRes.json();
      setAuth({ jwt: token, user: userObj });
      setStatus("authenticated");
      persist(token, userObj);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[AppAuth] signIn failed:", err);
      setStatus("error");
      setError(err?.message || "Sign-in failed");
    } finally {
      inflightRef.current = false;
    }
  }, [addressLc, persist]);

  const signOut = useCallback(() => {
    setAuth({ jwt: null, user: null });
    setStatus("idle");
    setError(null);
    clearStorage();
  }, [clearStorage]);

  const getAuthHeaders = useCallback(() => {
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }, [jwt]);

  // Effect: react to address change / disconnect.
  useEffect(() => {
    if (walletStatus === "disconnected" || !addressLc) {
      // Disconnect — clear everything. (Don't trigger this during
      // 'reconnecting' — that's a transient state, not a real disconnect.)
      // Always reset status/error here, not just when jwt/user are set —
      // a failed sign-in leaves status='error'/'rejected' with null jwt,
      // and that error must clear when the wallet goes away or the retry
      // banner sticks across sessions.
      if (jwt || user || status !== "idle") {
        setAuth({ jwt: null, user: null });
        setStatus("idle");
        setError(null);
        clearStorage();
      }
      return;
    }

    // Address mismatch with stored JWT — clear and let the auto-fire effect kick in.
    if (jwt) {
      const payload = decodeJwtPayload(jwt);
      if (payload?.wallet_address !== addressLc) {
        setAuth({ jwt: null, user: null });
        setStatus("idle");
        clearStorage();
        return;
      }
    } else {
      // No in-memory JWT — try to rehydrate from storage in case localStorage was
      // updated by another tab.
      const persisted = readPersistedAuth(addressLc);
      if (persisted) {
        setAuth({ jwt: persisted.token, user: persisted.user });
        setStatus("authenticated");
      }
    }
  }, [addressLc, walletStatus, jwt, user, status, clearStorage]);

  // Effect: auto-fire on connect when no valid JWT and wallet type qualifies.
  // Gated on walletStatus === 'connected' (not isConnected) so we don't try to
  // signMessage during wagmi's reconnecting-hydration window — see comment
  // above the useAccount() call for the failure mode.
  useEffect(() => {
    if (!isFullyConnected || !addressLc) return;
    if (!walletType || !AUTO_FIRE_WALLET_TYPES.has(walletType)) return;
    if (jwt) return;
    if (status === "signing" || status === "verifying") return;
    if (status === "rejected" || status === "error") return; // don't loop
    void signIn({ method: "wallet" });
  }, [isFullyConnected, addressLc, walletType, jwt, status, signIn]);

  const value = useMemo(
    () => ({ jwt, user, status, error, signIn, signOut, getAuthHeaders }),
    [jwt, user, status, error, signIn, signOut, getAuthHeaders],
  );

  return (
    <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
  );
}

AppAuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
