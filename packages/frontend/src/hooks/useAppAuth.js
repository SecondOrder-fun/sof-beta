import { useContext } from "react";
import { AppAuthContext } from "@/context/AppAuthProvider";

/**
 * useAppAuth — access the global JWT lifecycle exposed by AppAuthProvider.
 *
 * Returns: { jwt, user, status, error, signIn, signOut, getAuthHeaders }.
 * Throws if used outside <AppAuthProvider>.
 *
 * Replaces the deleted useAdminAuth and the JWT half of useFarcaster.
 */
export function useAppAuth() {
  const ctx = useContext(AppAuthContext);
  if (ctx === null || ctx === undefined) {
    throw new Error(
      "useAppAuth must be used within an AppAuthProvider — see main.jsx",
    );
  }
  return ctx;
}
