// src/components/launchpad/PriceChart.jsx
//
// FDV over time for one launch token, per the approved chart design: the
// valuation headline with its change over the selected range, range Tabs, an
// area line with the launch valuation as a dashed baseline, and a tooltip
// carrying FDV, price per token and the multiple since launch.
//
// Reads GET /api/launchpad/tokens/:address/chart (prices as `priceE18`, quote raw
// units per whole token × 1e18). The live pool valuation (market.fdv, from
// useLaunchMarkets) extends the line to "now" — a clock (useNow) that moves on
// its own, so a quiet token's line still reaches the present — and drives the
// headline, so the headline matches the buy panel even between indexer ticks; the pool's own
// launch valuation (market.launchFdv, not the requested price the indexer
// stores) anchors the launch baseline and the multiples, so they agree with the
// header's multiple. With
// no trades, it shows the launch valuation and an empty state instead of a
// flat line. A failed refetch keeps the cached history on screen; only a
// failed read with nothing cached says the history is unavailable. The
// headline is a skeleton only while a read is in flight; with neither a pool
// price nor any history, it is a dash.
//
// Every figure is in the launch's quote token (market.quote, else the chart
// response's quoteSymbol / quoteDecimals, else ETH) and prints through
// formatFdv — headline, tooltip, axis, launch line — so one valuation never
// reads two ways on the same card.

import { useId, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTokenChart } from "@/hooks/useLaunchActivity";
import { useNow } from "@/hooks/useNow";
import { CHART_RANGES, buildChartSeries, formatChartTime, unitsToRaw } from "@/lib/launchChart";
import { formatFdv, formatMultiple, formatTokenPrice } from "@/lib/launchFormat";
import { ETH_QUOTE } from "@/config/launchQuoteTokens";
import { cn } from "@/lib/utils";

/** Decimals on every valuation the chart prints; trailing zeros are dropped. */
const FDV_DECIMALS = 2;

const ChartTooltip = ({ active, payload, range, quote }) => {
  const { t } = useTranslation("launchpad");
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const price = formatTokenPrice(p.fdvRaw, quote);
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md space-y-1">
      <div className="text-xs text-muted-foreground">{formatChartTime(p.t, range === "all" ? "all" : "24h")}</div>
      <div className="text-lg font-semibold text-heading">
        {formatFdv(p.fdvRaw, quote.decimals, FDV_DECIMALS)}{" "}
        <span className="text-xs font-medium text-muted-foreground">{t("chart.quoteFdv", { quote: quote.symbol })}</span>
      </div>
      <div className="text-muted-foreground">{t("detail.pricePerToken", { price: price.value, unit: price.unit })}</div>
      <div className="font-semibold text-fabric-red">{t("chart.multiple", { value: formatMultiple(p.multiple) })}</div>
    </div>
  );
};

ChartTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  range: PropTypes.string,
  quote: PropTypes.shape({ symbol: PropTypes.string, decimals: PropTypes.number }),
};

const PriceChart = ({ token, market, isMarketLoading = false }) => {
  const { t } = useTranslation("launchpad");
  const gradientId = useId().replace(/:/g, "_");
  const [range, setRange] = useState("24h");
  const { data: chart, isLoading, isError } = useTokenChart(token, range);
  // The clock the line is carried to. On a quiet token neither the history
  // nor the pool changes, so "now" has to move on its own.
  const nowMs = useNow();
  const quote =
    market?.quote ??
    (chart?.quoteSymbol ? { symbol: chart.quoteSymbol, decimals: Number(chart.quoteDecimals ?? 18) } : ETH_QUOTE);
  const fdvText = (raw) => formatFdv(raw, quote.decimals, FDV_DECIMALS);

  const view = useMemo(
    () =>
      chart?.launch
        ? buildChartSeries({
            chart,
            launchFdv: market?.launchFdv,
            currentFdv: market?.fdv,
            nowSec: Math.floor(nowMs / 1000),
            decimals: quote.decimals,
          })
        : null,
    [chart, market?.launchFdv, market?.fdv, nowMs, quote.decimals],
  );

  const headline = market
    ? fdvText(market.fdv)
    : view?.series.length
      ? fdvText(view.series.at(-1).fdvRaw)
      : null;
  const marketPrice = market ? formatTokenPrice(market.fdv, quote) : null;
  const change = view?.hasTrades ? view.changePct : null;

  return (
    <section aria-label={t("chart.label")} className="rounded-xl border border-primary p-1">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">{t("detail.fdvLabel")}</div>
              {headline != null ? (
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-4xl font-semibold tracking-tight text-heading">
                    {headline} <span className="text-lg font-medium text-muted-foreground">{quote.symbol}</span>
                  </span>
                  {change != null ? (
                    <span className={cn("text-sm font-semibold", change >= 0 ? "text-success" : "text-destructive")}>
                      {t("chart.change", {
                        sign: change >= 0 ? "+" : "−",
                        pct: Math.abs(change).toFixed(1),
                        range: t(`chart.range.${range}`),
                      })}
                    </span>
                  ) : null}
                </div>
              ) : isLoading || isMarketLoading ? (
                <Skeleton className="h-10 w-48" />
              ) : (
                // Both reads are done and neither has a price: say so.
                <span className="text-4xl font-semibold tracking-tight text-muted-foreground">—</span>
              )}
              {market ? (
                <div className="text-sm text-muted-foreground">
                  <span className="font-semibold text-fabric-red">
                    {t("detail.sinceLaunch", {
                      multiple: formatMultiple(market.multiple),
                      launchFdv: fdvText(market.launchFdv),
                      quote: quote.symbol,
                    })}
                  </span>
                  {" · "}
                  {t("detail.pricePerToken", { price: marketPrice.value, unit: marketPrice.unit })}
                </div>
              ) : null}
            </div>

            <Tabs value={range} onValueChange={setRange}>
              <TabsList aria-label={t("chart.rangeLabel")}>
                {CHART_RANGES.map((r) => (
                  <TabsTrigger key={r} value={r} className="px-3 py-1.5">
                    <span>{t(`chart.range.${r}`)}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="relative h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (isError && !chart) || !view ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("chart.unavailable")}
              </div>
            ) : !view.hasTrades ? (
              <div className="relative flex h-full items-center justify-center">
                <span className="absolute inset-x-0 bottom-10 border-t border-dashed border-muted-foreground" aria-hidden="true" />
                <span className="absolute left-0 bottom-[34px] h-2.5 w-2.5 rounded-full bg-fabric-red" aria-hidden="true" />
                <span className="absolute left-5 bottom-12 text-xs text-muted-foreground">
                  {t("chart.launchLine", { fdv: fdvText(view.launchFdvRaw), quote: quote.symbol })}
                </span>
                <span className="text-sm text-muted-foreground">{t("chart.empty")}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={view.series} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(v) => formatChartTime(v, range)}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    orientation="right"
                    width={56}
                    domain={[0, "auto"]}
                    tickFormatter={(v) =>
                      t("chart.axisQuote", { value: fdvText(unitsToRaw(v, quote.decimals)), quote: quote.symbol })
                    }
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReferenceLine
                    y={view.launchFdv}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 6"
                    label={{
                      value: t("chart.launchLine", { fdv: fdvText(view.launchFdvRaw), quote: quote.symbol }),
                      position: "insideBottomLeft",
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                  <Tooltip
                    content={<ChartTooltip range={range} quote={quote} />}
                    cursor={{ stroke: "hsl(var(--pastel-rose))", strokeDasharray: "3 4" }}
                  />
                  <Area
                    type="linear"
                    dataKey="fdv"
                    stroke="hsl(var(--fabric-red))"
                    strokeWidth={2.4}
                    fill={`url(#${gradientId})`}
                    activeDot={{ r: 6, fill: "hsl(var(--pastel-rose))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

PriceChart.propTypes = {
  token: PropTypes.string.isRequired,
  market: PropTypes.shape({
    fdv: PropTypes.any,
    launchFdv: PropTypes.any,
    multiple: PropTypes.number,
    quote: PropTypes.shape({ symbol: PropTypes.string, decimals: PropTypes.number }),
  }),
  /** The pool read is in flight — the headline waits for it rather than dashing. */
  isMarketLoading: PropTypes.bool,
};

export default PriceChart;
