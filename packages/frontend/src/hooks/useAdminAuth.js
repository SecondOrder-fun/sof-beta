/**
 * useAdminAuth — manages wallet-based JWT authentication for admin operations.
 *
 * Must be used inside <AdminAuthProvider>.
 */

import { useContext } from "react";
import { AdminAuthContext } from "@/context/AdminAuthContext";

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used within an <AdminAuthProvider>");
  }
  return ctx;
}
