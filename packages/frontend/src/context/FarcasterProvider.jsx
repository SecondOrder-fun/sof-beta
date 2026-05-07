/**
 * FarcasterProvider — auth-kit profile state only.
 *
 * Backend JWT lifecycle moved to AppAuthProvider (spec §5). This provider
 * keeps the useProfile() data + the relay nonce fetcher used by
 * useFarcasterSignIn. Verification with the backend is delegated to
 * AppAuthProvider via useAppAuth().signIn({ method: 'farcaster', ... }).
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
