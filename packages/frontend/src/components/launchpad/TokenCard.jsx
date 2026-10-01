// src/components/launchpad/TokenCard.jsx
// One launched token in the discovery grid.

import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import TokenArt from "@/components/launchpad/TokenArt";
import { shortAddress } from "@/lib/format";
import { formatAge, formatFdvEth, formatMultiple, formatPercent } from "@/lib/launchFormat";

const TokenCard = ({ launch, market }) => {
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
};

export default TokenCard;
