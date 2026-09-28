// src/components/launchpad/TokenCard.jsx
// One launched token in the discovery feed.

import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { shortAddress } from "@/lib/format";
import { formatFdvEth, formatPriceGwei, formatAge } from "@/lib/launchFormat";

const TokenCard = ({ launch }) => {
  const { t } = useTranslation("launchpad");

  return (
    <Link
      to={`/tokens/${launch.token}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <Card className="h-full transition-colors hover:border-primary">
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold truncate text-foreground">
                {launch.name || shortAddress(launch.token)}
              </div>
              <div className="text-xs text-muted-foreground font-mono truncate">
                {launch.symbol}
              </div>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatAge(launch.launchedAt)}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("card.valuation")}
              </dt>
              <dd className="font-medium text-foreground">
                {formatFdvEth(launch.impliedFdvWei)} ETH
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("card.startPrice")}
              </dt>
              <dd className="font-medium text-foreground">
                {formatPriceGwei(launch.startPriceWei)} gwei
              </dd>
            </div>
          </dl>

          <div className="mt-3 text-xs text-muted-foreground">
            {t("card.creator")}{" "}
            <span className="font-mono">{shortAddress(launch.creator)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

TokenCard.propTypes = {
  launch: PropTypes.shape({
    launchId: PropTypes.number,
    token: PropTypes.string.isRequired,
    creator: PropTypes.string,
    name: PropTypes.string,
    symbol: PropTypes.string,
    launchedAt: PropTypes.any,
    startPriceWei: PropTypes.any,
    impliedFdvWei: PropTypes.any,
  }).isRequired,
};

export default TokenCard;
