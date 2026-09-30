// src/components/launchpad/PriceChart.jsx
//
// FDV over time for one launch token, per the approved chart design: the
// valuation headline with its change over the selected range, range Tabs, an
// area line with the launch valuation as a dashed baseline, and a tooltip
// carrying FDV, price per token and the multiple since launch.
//
// Reads GET /api/launchpad/tokens/:address/chart. The live pool price (from
// useLaunchMarkets) extends the line to "now" and drives the headline, so the
// headline matches the buy panel even between indexer ticks. With no trades,
// it shows the launch valuation and an empty state instead of a flat line.

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
import { CHART_RANGES, buildChartSeries, formatChartTime } from "@/lib/launchChart";
import { formatFdvEth, formatMultiple, formatPriceGwei } from "@/lib/launchFormat";
import { cn } from "@/lib/utils";

const fmtEth = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

const ChartTooltip = ({ active, payload, range }) => {
  const { t } = useTranslation("launchpad");
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md space-y-1">
      <div className="text-xs text-muted-foreground">{formatChartTime(p.t, range === "all" ? "all" : "24h")}</div>
      <div className="text-lg font-semibold text-heading">
        {fmtEth(p.fdv)} <span className="text-xs font-medium text-muted-foreground">{t("chart.ethFdv")}</span>
      </div>
      <div className="text-muted-foreground">{t("detail.pricePerToken", { price: formatPriceGwei(BigInt(p.priceWei)) })}</div>
      <div className="font-semibold text-fabric-red">{t("chart.multiple", { value: formatMultiple(p.multiple) })}</div>
    </div>
  );
};

ChartTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  range: PropTypes.string,
};

const PriceChart = ({ token, market }) => {
  const { t } = useTranslation("launchpad");
  const gradientId = useId().replace(/:/g, "_");
  const [range, setRange] = useState("24h");
  const { data: chart, isLoading, isError } = useTokenChart(token, range);

  const view = useMemo(
    () =>
      chart?.launch
        ? buildChartSeries({ chart, currentPriceWei: market?.priceWei, nowSec: Math.floor(Date.now() / 1000) })
        : null,
    [chart, market?.priceWei],
  );

  const headline = market ? formatFdvEth(market.fdvWei, 2) : view?.series.length ? fmtEth(view.series.at(-1).fdv) : null;
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
                    {headline} <span className="text-lg font-medium text-muted-foreground">ETH</span>
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
              ) : (
                <Skeleton className="h-10 w-48" />
              )}
              {market ? (
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
            ) : isError || !view ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("chart.unavailable")}
              </div>
            ) : !view.hasTrades ? (
              <div className="relative flex h-full items-center justify-center">
                <span className="absolute inset-x-0 bottom-10 border-t border-dashed border-muted-foreground" aria-hidden="true" />
                <span className="absolute left-0 bottom-[34px] h-2.5 w-2.5 rounded-full bg-fabric-red" aria-hidden="true" />
                <span className="absolute left-5 bottom-12 text-xs text-muted-foreground">
                  {t("chart.launchLine", { fdv: fmtEth(view.launchFdv) })}
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
                    tickFormatter={(v) => `${fmtEth(v)} ETH`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReferenceLine
                    y={view.launchFdv}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 6"
                    label={{
                      value: t("chart.launchLine", { fdv: fmtEth(view.launchFdv) }),
                      position: "insideBottomLeft",
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                  <Tooltip
                    content={<ChartTooltip range={range} />}
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
    fdvWei: PropTypes.any,
    launchFdvWei: PropTypes.any,
    priceWei: PropTypes.any,
    multiple: PropTypes.number,
  }),
};

export default PriceChart;
