// src/components/launchpad/SupplySold.jsx
//
// How much of the placed supply has sold, on the existing Progress primitive.
//
// This is the launchpad's progress metric in place of a graduation bar: the pool
// is the market from block one, so there is no threshold to cross. The share is
// what has actually left the pool, summed over the ladder's bands' own token
// balances (v4PoolMath.bandsSoldFraction) — not a distance across a price range.
// Every liquidity preset's last band runs to the end of v4's price scale, so the
// bar never fills: there is liquidity at every price and nothing to "sell out". The left end carries the
// launch valuation, in the launch's quote; the note under the bar says why there
// is no sellout valuation on the right.

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ETH_QUOTE } from "@/config/launchQuoteTokens";
import { formatFdv, formatPercent, formatSupply } from "@/lib/launchFormat";

const SupplySold = ({ market, totalSupply, symbol }) => {
  const { t } = useTranslation("launchpad");
  const quote = market.quote ?? ETH_QUOTE;
  const pct = market.soldFraction * 100;
  const soldRaw = (BigInt(totalSupply) * BigInt(Math.round(market.soldFraction * 1e6))) / 1_000_000n;

  // Quarter markers; the left end carries the launch valuation.
  const steps = [
    {
      position: 0,
      label: t("detail.launchMarker", { fdv: formatFdv(market.launchFdv, quote.decimals, 2), quote: quote.symbol }),
    },
    { position: 25 },
    { position: 50 },
    { position: 75 },
    { position: 100 },
  ];

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            <span className="text-xl font-semibold text-heading mr-2">{formatPercent(market.soldFraction)}%</span>
            {t("detail.soldLabel")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("detail.soldCount", { sold: formatSupply(soldRaw), total: formatSupply(BigInt(totalSupply)), symbol })}
          </span>
        </div>
        <Progress value={pct} steps={steps} />
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{steps[0].label}</span>
          <span className="text-right">{t("detail.soldNote")}</span>
        </div>
      </CardContent>
    </Card>
  );
};

SupplySold.propTypes = {
  market: PropTypes.shape({
    soldFraction: PropTypes.number.isRequired,
    launchFdv: PropTypes.any,
    quote: PropTypes.shape({ symbol: PropTypes.string, decimals: PropTypes.number }),
  }).isRequired,
  totalSupply: PropTypes.any.isRequired,
  symbol: PropTypes.string,
};

export default SupplySold;
