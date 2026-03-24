/* global __APP_VERSION__, __GIT_HASH__ */
/**
 * Bottom Navigation
 * Fixed 4-tab navigation footer for mobile interfaces
 */

import PropTypes from "prop-types";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Ticket, TrendingUp, Wallet, Trophy, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSafeArea } from "@/hooks/useSafeArea";

export const BottomNav = ({ className = "" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const safeArea = useSafeArea();
  const { t } = useTranslation(["navigation"]);

  const tabs = [
    {
      id: "raffles",
      label: t("navigation:raffles"),
      icon: Ticket,
      path: "/raffles",
    },
    {
      id: "infofi",
      label: t("navigation:markets"),
      icon: TrendingUp,
      path: "/markets",
    },
    {
      id: "portfolio",
      label: t("navigation:portfolio"),
      icon: Wallet,
      path: "/portfolio",
    },
    {
      id: "ranking",
      label: t("navigation:leaderboard"),
      icon: Trophy,
      path: "/leaderboard",
    },
    {
      id: "swap",
      label: t("navigation:getSOF"),
      icon: ArrowLeftRight,
      path: "/swap",
    },
  ];

  const getActiveTab = () => {
    const path = location.pathname;
    if (path.startsWith("/raffles") || path.startsWith("/raffle/"))
      return "raffles";
    if (path.startsWith("/markets") || path.startsWith("/market/"))
      return "infofi";
    if (path.startsWith("/portfolio")) return "portfolio";
    if (path.startsWith("/leaderboard") || path.startsWith("/users"))
      return "ranking";
    if (path.startsWith("/swap")) return "swap";
    return "raffles";
  };

  const activeTab = getActiveTab();

  const version =
    typeof __APP_VERSION__ !== "undefined" &&
    typeof __GIT_HASH__ !== "undefined"
      ? `v${__APP_VERSION__}-${__GIT_HASH__}`
      : "dev";

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 bg-background border-t border-border/20 ${className}`}
      style={{
        paddingBottom: `max(${safeArea.bottom}px, 8px)`,
      }}
    >
      <div className="max-w-screen-sm mx-auto">
        {/* Navigation Buttons */}
        <div className="grid grid-cols-5 gap-1.5 px-1.5 pt-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <Button
                key={tab.id}
                variant={isActive ? "default" : "outline"}
                onClick={() => navigate(tab.path)}
                className={`flex flex-col items-center justify-center gap-1 h-auto py-2 px-1 rounded-lg ${isActive ? "shadow-lg shadow-primary/30" : "opacity-60"}`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-tight">
                  {tab.label}
                </span>
              </Button>
            );
          })}
        </div>

        {/* Copyright and Version */}
        <div className="flex items-center justify-center gap-2 pt-1 pb-1">
          <p className="text-[9px] text-muted-foreground/70">
            &copy; {new Date().getFullYear()} SecondOrder.fun
          </p>
          <span className="text-[8px] text-muted-foreground/50">{version}</span>
        </div>
      </div>
    </nav>
  );
};

BottomNav.propTypes = {
  className: PropTypes.string,
};

export default BottomNav;
