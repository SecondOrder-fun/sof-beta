// src/components/infofi/OddsChart.jsx
import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * OddsChart Component
 * Displays odds over time for a prediction market
 *
 * Modes:
 * - default: Full chart with YES/NO lines, all time tabs, legend
 * - compact: Shorter chart, YES line only, fewer tabs (6H,1D,1W,All), smaller text
 * - mini: Bare chart line only (no tabs, no legend, no grid), for card thumbnails
 *
 * @param {Object} props
 * @param {string|number} props.marketId
 * @param {boolean} props.compact - Compact mode for detail views
 * @param {boolean} props.mini - Minimal mode for card thumbnails (overrides compact)
 */
const OddsChart = ({ marketId, compact = false, mini = false, lineColor }) => {
  const { t } = useTranslation("market");
  const [timeRange, setTimeRange] = React.useState("ALL");

  // In mini mode, always use ALL
  const effectiveRange = mini ? "ALL" : timeRange;

  // Fetch historical odds data
  const {
    data: oddsHistory,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["oddsHistory", marketId, effectiveRange],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE}/infofi/markets/${marketId}/history?range=${effectiveRange}`
      );
      if (!response.ok) throw new Error("Failed to fetch odds history");
      return response.json();
    },
    enabled: !!marketId,
    retry: 1,
  });

  // Transform data for Recharts
  const chartData = React.useMemo(() => {
    if (!oddsHistory?.dataPoints || oddsHistory.dataPoints.length === 0) {
      return null;
    }

    return oddsHistory.dataPoints.map((point) => ({
      timestamp: new Date(point.timestamp).toISOString(),
      yes: point.yes_bps / 100,
      no: point.no_bps / 100,
    }));
  }, [oddsHistory]);

  // Dynamic Y-axis domain based on actual data range
  const { domainMin, domainMax, axisTicks } = React.useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { domainMin: 0, domainMax: 100, axisTicks: [0, 50, 100] };
    }
    const values = chartData.map((d) => d.yes);
    if (!compact && !mini) values.push(...chartData.map((d) => d.no));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    // Proportional padding: at least 5pp, or 15% of range, rounded to nearest 5
    const padding = Math.max(5, Math.ceil((range * 0.15) / 5) * 5);
    const dMin = Math.max(0, Math.floor((min - padding) / 5) * 5);
    const dMax = Math.min(100, Math.ceil((max + padding) / 5) * 5);

    // Dynamic tick step: scale with range instead of fixed count
    const tickStep = mini
      ? Math.max(5, Math.ceil((dMax - dMin) / 2 / 5) * 5)
      : (dMax - dMin) <= 30
        ? 5
        : 10;
    const ticks = [];
    for (let v = dMin; v <= dMax; v += tickStep) ticks.push(v);

    return { domainMin: dMin, domainMax: dMax, axisTicks: ticks };
  }, [chartData, compact, mini]);

  // Custom tooltip (hidden in mini mode)
  const CustomTooltip = ({ active, payload }) => {
    if (mini || !active || !payload?.length) return null;

    const data = payload[0].payload;

    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-2">
          {format(parseISO(data.timestamp), "MMM d, yyyy HH:mm")}
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-emerald-600">
              {t("yes")}
            </span>
            <span className="text-sm font-bold text-emerald-600">
              {data.yes.toFixed(1)}%
            </span>
          </div>
          {!compact && !mini && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-rose-600">
                {t("no")}
              </span>
              <span className="text-sm font-bold text-rose-600">
                {data.no.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  CustomTooltip.propTypes = {
    active: PropTypes.bool,
    payload: PropTypes.array,
  };

  // Format X-axis labels
  const formatXAxis = (timestamp) => {
    try {
      const date = parseISO(timestamp);

      switch (effectiveRange) {
        case "1H":
        case "6H":
          return format(date, "HH:mm");
        case "1D":
          return format(date, "HH:mm");
        case "1W":
          return format(date, "MMM d");
        case "1M":
          return format(date, "MMM d");
        case "ALL":
        default:
          return format(date, "MMM");
      }
    } catch {
      return "";
    }
  };

  // Derive height class
  const heightClass = mini ? "h-24" : compact ? "h-40" : "h-96";

  // Show loading state
  if (isLoading) {
    return (
      <div className={`${heightClass} flex items-center justify-center`}>
        <div className="animate-pulse text-muted-foreground text-sm">
          {t("loadingChart")}
        </div>
      </div>
    );
  }

  // Show error/empty
  if (error || !chartData || chartData.length === 0) {
    return (
      <div className={`${heightClass} flex items-center justify-center`}>
        <div className="text-center space-y-1">
          <p className="text-muted-foreground text-xs">
            {t("cannotRetrieveChartData")}
          </p>
        </div>
      </div>
    );
  }

  // ── Mini mode: chart with grid + axes + legend, no tabs ──
  if (mini) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-xs">
          <div
            className="w-3 h-0.5"
            style={{ backgroundColor: lineColor || "#10b981" }}
          ></div>
          <span className="text-muted-foreground">{t("yes")}</span>
        </div>
        <div className={heightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 2, right: 2, left: -25, bottom: 2 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: "9px" }}
              tickLine={false}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              ticks={axisTicks}
              tickFormatter={(value) => `${value}%`}
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: "9px" }}
              tickLine={false}
            />
            <Line
              type="monotone"
              dataKey="yes"
              stroke={lineColor || "#10b981"}
              strokeWidth={2}
              dot={false}
              activeDot={false}
            />
          </LineChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // ── Compact / Full mode ──
  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      {/* Time range selector + legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}
          >
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-emerald-500"></div>
              <span className="text-muted-foreground">{t("yes")}</span>
            </div>
            {!compact && (
              <div className="flex items-center gap-1">
                <div className="w-3 h-0.5 bg-rose-500"></div>
                <span className="text-muted-foreground">{t("no")}</span>
              </div>
            )}
          </div>
        </div>

        <Tabs value={timeRange} onValueChange={setTimeRange}>
          <TabsList className={compact ? "h-7" : "h-8"}>
            {!compact && (
              <TabsTrigger value="1H" className="text-xs px-2">
                1H
              </TabsTrigger>
            )}
            <TabsTrigger value="6H" className="text-xs px-2">
              6H
            </TabsTrigger>
            <TabsTrigger value="1D" className="text-xs px-2">
              1D
            </TabsTrigger>
            <TabsTrigger value="1W" className="text-xs px-2">
              1W
            </TabsTrigger>
            {!compact && (
              <TabsTrigger value="1M" className="text-xs px-2">
                1M
              </TabsTrigger>
            )}
            <TabsTrigger value="ALL" className="text-xs px-2">
              {t("all")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Chart */}
      <div className={heightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={
              compact
                ? { top: 2, right: 2, left: -25, bottom: 2 }
                : { top: 5, right: 5, left: -20, bottom: 5 }
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: compact ? "10px" : "12px" }}
              tickLine={false}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              ticks={axisTicks}
              tickFormatter={(value) => `${value}%`}
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: compact ? "10px" : "12px" }}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="yes"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: compact ? 3 : 4 }}
            />
            {!compact && (
              <Line
                type="monotone"
                dataKey="no"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

OddsChart.propTypes = {
  marketId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
  compact: PropTypes.bool,
  mini: PropTypes.bool,
  lineColor: PropTypes.string,
};

export default OddsChart;
