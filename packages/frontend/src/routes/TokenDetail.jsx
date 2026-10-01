// src/routes/TokenDetail.jsx
//
// One launched token, per the approved launchpad design: identity, live
// valuation, supply sold, trades, and the buy panel. Desktop puts the panel in
// a sticky side column; mobile opens the same panel in the existing Sheet from
// a bar above the bottom nav.
//
// Everything here is composed from existing primitives. Two parts of the
// design are deliberately absent until confirmed and built: the price chart
// (a new component, and it needs trade history) and the raffle card (Phase 2).

import { useState } from "react";
import PropTypes from "prop-types";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isAddress } from "viem";
import { ArrowLeft, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import TokenArt from "@/components/launchpad/TokenArt";
import BuyPanel from "@/components/launchpad/BuyPanel";
import SupplySold from "@/components/launchpad/SupplySold";
import LaunchTrades from "@/components/launchpad/LaunchTrades";
import { usePlatform } from "@/hooks/usePlatform";
import { useTokenLaunch } from "@/hooks/useTokenLaunches";
import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";
import { shortAddress } from "@/lib/format";
import { formatAge, formatFdvEth, formatMultiple, formatPriceGwei } from "@/lib/launchFormat";

const Fact = ({ label, children }) => (
  <div className="flex justify-between gap-4 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

Fact.propTypes = {
  label: PropTypes.node.isRequired,
  children: PropTypes.node,
};

const TokenDetail = () => {
  const { t } = useTranslation("launchpad");
  const { address } = useParams();
  const { isMobile, isMobileBrowser } = usePlatform();
  const compact = isMobile || isMobileBrowser;
  const valid = typeof address === "string" && isAddress(address);

  const { data: launch, isLoading, isAvailable } = useTokenLaunch(valid ? address : undefined);
  const { markets } = useLaunchMarkets(launch ? [launch] : [], { enabled: Boolean(launch) });
  const market = launch ? markets[launch.token.toLowerCase()] : undefined;

  const [copied, setCopied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

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
      <div className="space-y-4">
        <Skeleton className="h-20 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!valid || !launch) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Alert>
          <AlertTitle>{t("detail.notFoundTitle")}</AlertTitle>
          <AlertDescription>{t("detail.notFoundBody")}</AlertDescription>
        </Alert>
        <Link to="/tokens" className="inline-flex items-center gap-2 text-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("detail.backToTokens")}
        </Link>
      </div>
    );
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(launch.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions) — the
      // address is still on screen, so failing quietly loses nothing.
    }
  };

  const panel = <BuyPanel token={launch.token} symbol={launch.symbol} market={market} />;

  return (
    <div className={compact ? "space-y-5 pb-20" : "space-y-6"}>
      <Link to="/tokens" className="inline-flex items-center gap-2 text-sm">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("detail.backToTokens")}
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <div className="space-y-6 min-w-0">
          <section className="flex items-center gap-4">
            <TokenArt
              token={launch.token}
              symbol={launch.symbol}
              name={launch.name}
              className={compact ? "h-14 w-14" : "h-20 w-20"}
              textClassName={compact ? "text-3xl" : "text-5xl"}
            />
            <div className="min-w-0 space-y-2">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-3xl font-semibold tracking-tight">{launch.name}</h1>
                <span className="font-mono text-muted-foreground">${launch.symbol}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyAddress}
                  aria-label={t("detail.copyAddress")}
                  className="gap-2 font-mono text-xs"
                >
                  {shortAddress(launch.token)}
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <span>
                  {t("detail.launchedBy")}{" "}
                  <Link to={`/users/${launch.creator}`} className="font-mono">
                    {shortAddress(launch.creator)}
                  </Link>
                </span>
                <span>{formatAge(launch.launchedAt)}</span>
              </div>
            </div>
          </section>

          <section className="space-y-1">
            <div className="text-sm text-muted-foreground">{t("detail.fdvLabel")}</div>
            {market ? (
              <>
                <div className="text-5xl font-semibold tracking-tight text-heading">
                  {formatFdvEth(market.fdvWei, 2)} <span className="text-2xl text-muted-foreground">ETH</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-semibold text-fabric-red">
                    {t("detail.sinceLaunch", {
                      multiple: formatMultiple(market.multiple),
                      launchFdv: formatFdvEth(market.launchFdvWei, 2),
                    })}
                  </span>
                  {" · "}
                  {t("detail.pricePerToken", { price: formatPriceGwei(market.priceWei) })}
                </div>
              </>
            ) : (
              <Skeleton className="h-12 w-64" />
            )}
          </section>

          {market ? (
            <SupplySold market={market} totalSupply={launch.totalSupply} symbol={launch.symbol} />
          ) : null}

          <LaunchTrades token={launch.token} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          {compact ? null : panel}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("detail.factsTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <Fact label={t("detail.factSupply")}>{(launch.totalSupply / 10n ** 18n).toLocaleString()}</Fact>
                <Fact label={t("detail.factAllocation")}>{t("detail.factAllocationValue")}</Fact>
                <Fact label={t("detail.factLiquidity")}>{t("detail.factLiquidityValue")}</Fact>
                <Fact label={t("detail.factControls")}>{t("detail.factControlsValue")}</Fact>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>

      {compact ? (
        <>
          <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background p-3">
            <Button type="button" size="lg" className="w-full" onClick={() => setSheetOpen(true)}>
              {t("detail.buyCta", { symbol: launch.symbol })}
            </Button>
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            {/* Same shell as the ticket BuySellSheet, so both trade sheets read as one pattern. */}
            <SheetContent
              side="bottom"
              className="bg-background border-t-2 border-primary rounded-t-2xl px-3 max-w-screen-sm mx-auto max-h-[90vh] overflow-y-auto"
            >
              <SheetHeader className="mb-2">
                <SheetTitle>{t("trade.title", { symbol: launch.symbol })}</SheetTitle>
                <SheetDescription className="sr-only">{t("trade.title", { symbol: launch.symbol })}</SheetDescription>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </div>
  );
};

export default TokenDetail;
