// src/components/launchpad/TokenCard.jsx
// One launched token in the discovery grid, with its raffle badge when a
// season is priced in it. The live raffle strip's "X left" follows the clock
// (useNow) rather than freezing at first render; the clock runs inside
// RaffleTimeLeft, so a card with no countdown on it keeps no timer.
//
// The strip's prize is the pool from the one batched badge request (the backend
// reads a live season's from its curve), not a curve read per card. A pool of
// zero — nothing sold yet, or not known — shows the season alone rather than
// "0 POND".

import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import TokenArt from "@/components/launchpad/TokenArt";
import RaffleBadge from "@/components/launchpad/RaffleBadge";
import { useNow } from "@/hooks/useNow";
import { shortAddress } from "@/lib/format";
import {
  formatAge,
  formatFdvEth,
  formatMultiple,
  formatPercent,
  formatSupply,
  formatTimeLeft,
} from "@/lib/launchFormat";

const RaffleTimeLeft = ({ endTime }) => {
  const { t } = useTranslation("launchpad");
  const nowMs = useNow();
  return (
    <span className="shrink-0 text-muted-foreground">
      {t("card.raffleLeft", { time: formatTimeLeft(endTime, t, nowMs) })}
    </span>
  );
};

RaffleTimeLeft.propTypes = { endTime: PropTypes.number.isRequired };

/** The live strip's label: the season, with its pool when there is one to name. */
const raffleStripLabel = (raffle, symbol, t) => {
  const season = raffle.name || t("raffle.season", { id: raffle.seasonId });
  const pool = BigInt(raffle.prizePool ?? 0);
  return pool > 0n ? t("card.raffleStrip", { season, prize: formatSupply(pool), symbol }) : season;
};

const TokenCard = ({ launch, market, raffle }) => {
  const { t } = useTranslation("launchpad");

  return (
    <Link
      to={`/tokens/${launch.token}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors hover:border-fabric-red">
        <div className="relative">
          <TokenArt
            token={launch.token}
            symbol={launch.symbol}
            name={launch.name}
            className="h-40 w-full rounded-none"
            textClassName="text-8xl"
          />
          <Badge variant="secondary" className="absolute left-3 top-3">
            {formatAge(launch.launchedAt)}
          </Badge>
          <RaffleBadge raffle={raffle} className="absolute right-3 top-3" />
        </div>

        <CardContent className="p-4 space-y-3">
          <div className="min-w-0">
            <div className="font-semibold text-heading truncate">
              {launch.name || shortAddress(launch.token)}
            </div>
            <div className="text-xs text-muted-foreground font-mono truncate">${launch.symbol}</div>
          </div>

          {market ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-heading tracking-tight">
                  {formatFdvEth(market.fdvWei, 2)}
                </span>
                <span className="text-xs text-muted-foreground">{t("card.valuation")}</span>
                <span className="ml-auto text-xs font-semibold text-fabric-red">
                  {t("card.multiple", { value: formatMultiple(market.multiple) })}
                </span>
              </div>
              <div className="space-y-1.5">
                <Progress value={market.soldFraction * 100} className="h-2" />
                <div className="text-xs text-muted-foreground">
                  {t("card.sold", { value: formatPercent(market.soldFraction) })}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2" aria-label={t("card.pricing")}>
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-2 w-full" />
            </div>
          )}

          {raffle?.state === "live" ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-pastel-rose px-3 py-2 text-xs">
              <span className="font-semibold text-raffle truncate">
                {raffleStripLabel(raffle, launch.symbol, t)}
              </span>
              {raffle.endTime ? <RaffleTimeLeft endTime={raffle.endTime} /> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
};

TokenCard.propTypes = {
  launch: PropTypes.shape({
    token: PropTypes.string.isRequired,
    name: PropTypes.string,
    symbol: PropTypes.string,
    launchedAt: PropTypes.any,
  }).isRequired,
  market: PropTypes.shape({
    fdvWei: PropTypes.any,
    multiple: PropTypes.number,
    soldFraction: PropTypes.number,
  }),
  /** Featured season summary from /api/launchpad/raffles; omitted when none. */
  raffle: PropTypes.object,
};

export default TokenCard;
