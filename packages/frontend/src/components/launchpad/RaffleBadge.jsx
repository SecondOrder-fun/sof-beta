// src/components/launchpad/RaffleBadge.jsx
//
// A token's raffle state, as one Badge: live (filled Pastel Rose), opening
// soon and drawing (Pastel Rose outline), ended (muted outline). Takes a
// season summary from the backend (activityFeed.summarizeSeason).

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Clock, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTimeLeft } from "@/lib/launchFormat";

const RaffleBadge = ({ raffle, className }) => {
  const { t } = useTranslation("launchpad");
  if (!raffle) return null;

  switch (raffle.state) {
    case "live":
      return (
        <Badge variant="raffleLive" className={cn("pl-2", className)}>
          <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
          {t("raffle.badgeLive")}
        </Badge>
      );
    case "upcoming": {
      const opensIn = raffle.startTime && raffle.startTime * 1000 > Date.now();
      return (
        <Badge variant="raffleSoon" className={cn("pl-2", className)}>
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {opensIn ? t("raffle.badgeOpensIn", { time: formatTimeLeft(raffle.startTime) }) : t("raffle.badgeOpensSoon")}
        </Badge>
      );
    }
    case "drawing":
      return (
        <Badge variant="raffleSoon" className={cn("pl-2", className)}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {t("raffle.badgeDrawing")}
        </Badge>
      );
    default:
      return (
        <Badge variant="raffleEnded" className={className}>
          {t("raffle.badgeEnded")}
        </Badge>
      );
  }
};

RaffleBadge.propTypes = {
  raffle: PropTypes.shape({
    state: PropTypes.oneOf(["live", "upcoming", "drawing", "ended", "cancelled"]).isRequired,
    startTime: PropTypes.number,
  }),
  className: PropTypes.string,
};

export default RaffleBadge;
