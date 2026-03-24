/**
 * Mobile Header
 * Simplified header with branding and user profile for mobile interfaces
 */

import { useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import SystemMenu from "./SystemMenu";

export const MobileHeader = ({ className = "" }) => {
  const profile = useUserProfile();
  const { t } = useTranslation(["common", "account"]);
  const [isSystemMenuOpen, setIsSystemMenuOpen] = useState(false);

  const handleAvatarClick = () => {
    setIsSystemMenuOpen(!isSystemMenuOpen);
  };

  const handleSystemMenuClose = () => {
    setIsSystemMenuOpen(false);
  };

  return (
    <>
      <header
        className={`sticky top-0 z-50 bg-background border-b border-border/20 ${className}`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          {/* Logo + Branding - matching landing page */}
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/images/logo.png"
              alt={t("navigation:brandName")}
              className="w-10 h-10"
            />
            <h1 className="text-lg font-bold">
              <span className="text-foreground">Second</span>
              <span className="text-primary">Order</span>
              <span className="text-muted-foreground">.fun</span>
            </h1>
          </Link>

          {/* User Profile */}
          <button
            onClick={handleAvatarClick}
            className="relative p-0 bg-transparent border-0 hover:bg-transparent active:bg-transparent rounded-full"
          >
            <Avatar className="w-10 h-10 border-2 border-primary">
              {profile.pfpUrl ? (
                <AvatarImage
                  src={profile.pfpUrl}
                  alt={profile.displayName || t("account:username")}
                />
              ) : null}
              <AvatarFallback className="bg-card text-muted-foreground">
                {profile.displayName ? (
                  profile.displayName[0].toUpperCase()
                ) : (
                  <User className="w-5 h-5" />
                )}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </header>

      {/* System Menu - positioned below header */}
      <SystemMenu
        isOpen={isSystemMenuOpen}
        onClose={handleSystemMenuClose}
        profile={profile}
      />
    </>
  );
};

MobileHeader.propTypes = {
  className: PropTypes.string,
};

export default MobileHeader;
