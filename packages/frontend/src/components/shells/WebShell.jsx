/**
 * Web Shell
 * Standard desktop/web layout with full navigation and sidebar
 */

import PropTypes from "prop-types";
import { Outlet } from "react-router-dom";
import Navbar from "../Navbar";

export const WebShell = ({ children }) => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-6">
        {children || <Outlet />}
      </main>
    </div>
  );
};

WebShell.propTypes = {
  children: PropTypes.node,
};

export default WebShell;
