/**
 * Farcaster Mini App Shell
 * Mobile-optimized layout for Farcaster Mini Apps
 * Includes safe area handling and bottom navigation
 */

import PropTypes from "prop-types";
import { Outlet } from "react-router-dom";
import MobileHeader from "../mobile/MobileHeader";
import BottomNav from "../mobile/BottomNav";
import { useSafeArea } from "../../hooks/useSafeArea";

export const MiniAppShell = ({ children }) => {
  const safeArea = useSafeArea();

  return (
    <div
      className="min-h-screen bg-background flex flex-col overflow-x-hidden"
      style={{
        maxWidth: "100vw",
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

MiniAppShell.propTypes = {
  children: PropTypes.node,
};

export default MiniAppShell;
