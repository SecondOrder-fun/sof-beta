/**
 * DApp Browser Shell
 * Mobile-optimized layout for Base App and other dApp browsers
 * Similar to MiniAppShell but without Farcaster-specific features
 */

import PropTypes from "prop-types";
import { Outlet } from "react-router-dom";
import MobileHeader from "../mobile/MobileHeader";
import BottomNav from "../mobile/BottomNav";
import { useSafeArea } from "../../hooks/useSafeArea";

export const DappBrowserShell = ({ children }) => {
  const safeArea = useSafeArea();

  return (
    <div
      className="min-h-screen bg-background flex flex-col"
      style={{
        paddingTop: `${safeArea.top}px`,
        paddingBottom: `${safeArea.bottom}px`,
      }}
    >
      <MobileHeader />
      <main className="flex-1 overflow-y-auto pb-16">
        {children || <Outlet />}
      </main>
      <BottomNav />
    </div>
  );
};

DappBrowserShell.propTypes = {
  children: PropTypes.node,
};

export default DappBrowserShell;
