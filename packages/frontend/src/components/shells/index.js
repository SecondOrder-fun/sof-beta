/**
 * Shell Components
 * Auto-detects platform and exports appropriate shell
 */

import PropTypes from "prop-types";
import { usePlatform, PLATFORMS } from "../../hooks/usePlatform";
import WebShell from "./WebShell";
import MiniAppShell from "./MiniAppShell";
import DappBrowserShell from "./DappBrowserShell";

export { WebShell, MiniAppShell, DappBrowserShell };

/**
 * Shell component that auto-detects platform and renders appropriate layout
 */
export const Shell = ({ children }) => {
  const { platform } = usePlatform();

  switch (platform) {
    case PLATFORMS.FARCASTER:
      return <MiniAppShell>{children}</MiniAppShell>;
    case PLATFORMS.BASE_APP:
      return <DappBrowserShell>{children}</DappBrowserShell>;
    case PLATFORMS.WEB:
    default:
      return <WebShell>{children}</WebShell>;
  }
};

Shell.propTypes = {
  children: PropTypes.node,
};

export default Shell;
