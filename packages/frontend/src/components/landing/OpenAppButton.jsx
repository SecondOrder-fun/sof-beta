/**
 * Open App Button
 * Access-controlled button to enter the application
 */

import { useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAppIdentity } from "@/hooks/useAppIdentity";
import { ACCESS_LEVELS } from "@/config/accessLevels";

export const OpenAppButton = ({
  requiredLevel = ACCESS_LEVELS.ADMIN,
  className = "",
}) => {
  const navigate = useNavigate();
  const identity = useAppIdentity();
  const [isChecking, setIsChecking] = useState(false);

  const handleOpenApp = async () => {
    setIsChecking(true);

    try {
      // Check access via backend API
      const params = new URLSearchParams();
      if (identity.fid) params.append("fid", String(identity.fid));
      if (identity.walletAddress)
        params.append("wallet", identity.walletAddress);
      params.append("route", "/raffles");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(
          `${
            import.meta.env.VITE_API_BASE_URL
          }/access/check-access?${params.toString()}`,
          { signal: controller.signal },
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();

          if (data.hasAccess) {
            // User has access - navigate to app
            navigate("/raffles");
          } else {
            // User doesn't have access - show message
            alert(
              data.reason ||
                `Access restricted. Required level: ${getAccessLevelName(
                  requiredLevel,
                )}`,
            );
          }
        } else {
          // Backend error - allow access for better UX
          navigate("/raffles");
        }
      } catch (error) {
        clearTimeout(timeoutId);
        // Timeout or network error - allow access for better UX
        navigate("/raffles");
      }
    } finally {
      setIsChecking(false);
    }
  };

  const getAccessLevelName = (level) => {
    const names = {
      [ACCESS_LEVELS.PUBLIC]: "Public",
      [ACCESS_LEVELS.CONNECTED]: "Connected Wallet",
      [ACCESS_LEVELS.ALLOWLIST]: "Allowlist",
      [ACCESS_LEVELS.BETA]: "Beta Access",
      [ACCESS_LEVELS.ADMIN]: "Admin Access",
    };
    return names[level] || "Unknown";
  };

  return (
    <Button
      onClick={handleOpenApp}
      disabled={isChecking}
      className={`bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-6 text-lg rounded-lg transition-all shadow-lg shadow-primary/30 ${className}`}
    >
      {isChecking ? "Checking Access..." : "Open App"}
    </Button>
  );
};

OpenAppButton.propTypes = {
  requiredLevel: PropTypes.number,
  className: PropTypes.string,
};

export default OpenAppButton;
