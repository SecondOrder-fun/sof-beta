/**
 * PublicLayout
 *
 * Wrapper for public-facing routes (Landing, login callbacks).
 * Automatically transitions into the main app once the user has an identity.
 *
 * @returns {JSX.Element}
 */

import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppIdentity } from "@/hooks/useAppIdentity";

export default function PublicLayout() {
  const identity = useAppIdentity();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const hasIdentity = Boolean(identity.fid || identity.walletAddress);
    const isPublicPath =
      location.pathname === "/" || location.pathname === "/login";

    if (hasIdentity && isPublicPath) {
      navigate("/raffles", { replace: true });
    }
  }, [identity.fid, identity.walletAddress, location.pathname, navigate]);

  return <Outlet />;
}
