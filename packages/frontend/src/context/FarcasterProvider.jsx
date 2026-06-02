/**
 * FarcasterProvider — auth-kit profile state only.
 *
 * Backend JWT lifecycle lives in AppAuthProvider (spec §5). The browser-SIWF
 * QR surface that this provider's fetchNonce once fed was removed in PR #146;
 * MiniApp sign-in now runs end-to-end through AppAuthProvider.signIn({
 * method: 'farcaster' }) (which fetches its own nonce). Kept here for the
 * auth-kit `useProfile()` data that other UI surfaces still read.
 */

import { useCallback, useContext, useMemo } from "react";
import { useProfile } from "@farcaster/auth-kit";
import PropTypes from "prop-types";
import FarcasterContext from "./farcasterContext";

import { API_BASE } from "@/lib/apiBase";

const FarcasterProvider = ({ children }) => {
  const { isAuthenticated: isAuthKitAuthenticated, profile } = useProfile();

  const fetchNonce = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/nonce`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch nonce");
    }
    const { nonce } = await res.json();
    return nonce;
  }, []);

  const value = useMemo(
    () => ({
      // auth-kit state
      isAuthenticated: isAuthKitAuthenticated,
      profile: profile || null,
      // helpers
      fetchNonce,
    }),
    [isAuthKitAuthenticated, profile, fetchNonce],
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

export const useFarcasterSDK = () => {
  const context = useContext(FarcasterContext);
  if (!context) return { context: null };
  return { context };
};

export { FarcasterProvider };
