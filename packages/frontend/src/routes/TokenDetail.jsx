// src/routes/TokenDetail.jsx
//
// One launched token, from on-chain reads only.
//
// Live price, chart and trade history all need an index of pool swaps, which the
// launch indexer will provide. Rather than leave the feed pointing at nothing
// until then, this renders what the launchpad itself knows — the launch record —
// and says plainly what is still coming.

import PropTypes from "prop-types";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isAddress } from "viem";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { shortAddress } from "@/lib/format";
import { formatFdvEth, formatPriceGwei, formatSupply, formatAge } from "@/lib/launchFormat";
import { useTokenLaunch } from "@/hooks/useTokenLaunches";

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 border-b last:border-b-0">
    <dt className="text-muted-foreground text-sm">{label}</dt>
    <dd className="text-sm font-medium text-foreground text-right">{children}</dd>
  </div>
);

Row.propTypes = {
  label: PropTypes.node.isRequired,
  children: PropTypes.node,
};

const TokenDetail = () => {
  const { t } = useTranslation("launchpad");
  const { address } = useParams();
  const valid = typeof address === "string" && isAddress(address);
  const { data: launch, isLoading, isAvailable } = useTokenLaunch(valid ? address : undefined);

  if (!isAvailable) {
    return (
      <Alert>
        <AlertTitle>{t("unavailable.title")}</AlertTitle>
        <AlertDescription>{t("unavailable.body")}</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!valid || !launch) {
    return (
      <div className="max-w-2xl mx-auto">
        <Alert>
          <AlertTitle>{t("detail.notFoundTitle")}</AlertTitle>
          <AlertDescription>{t("detail.notFoundBody")}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/tokens">{t("detail.backToTokens")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{launch.name}</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">{launch.symbol}</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <dl>
            <Row label={t("detail.contract")}>
              <span className="font-mono">{shortAddress(launch.token)}</span>
            </Row>
            <Row label={t("detail.launchedBy")}>
              <Link to={`/users/${launch.creator}`} className="font-mono hover:text-primary">
                {shortAddress(launch.creator)}
              </Link>
            </Row>
            <Row label={t("detail.supply")}>{formatSupply(launch.totalSupply)}</Row>
            <Row label={t("detail.startPrice")}>
              {formatPriceGwei(launch.startPriceWei)} gwei
            </Row>
            <Row label={t("detail.valuation")}>
              {formatFdvEth(launch.impliedFdvWei)} ETH
            </Row>
            <Row label={t("detail.launchId")}>
              #{launch.launchId} · {formatAge(launch.launchedAt)}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("detail.tradingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <p className="text-sm text-muted-foreground">{t("detail.tradingBody")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("detail.raffleTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <p className="text-sm text-muted-foreground">{t("detail.raffleBody")}</p>
        </CardContent>
      </Card>

      <Button asChild variant="outline">
        <Link to="/tokens">{t("detail.backToTokens")}</Link>
      </Button>
    </div>
  );
};

export default TokenDetail;
