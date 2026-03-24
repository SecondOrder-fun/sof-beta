// src/components/curve/CurveGraph.jsx
import PropTypes from "prop-types";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatUnits } from "viem";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { useSofDecimals } from "@/hooks/useSofDecimals";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

/** SVG tooltip label rendered above step dots (click-to-toggle) */
const StepTooltipLabel = ({ viewBox, value }) => {
  if (!viewBox) return null;
  const cx = viewBox.cx ?? viewBox.x ?? 0;
  const cy = viewBox.cy ?? viewBox.y ?? 0;
  const textLen = value.length * 5.5 + 12;
  const rh = 16;
  return (
    <g>
      <rect
        x={cx - textLen / 2}
        y={cy - rh - 6}
        width={textLen}
        height={rh}
        rx={4}
        fill="hsl(var(--popover))"
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />
      <text
        x={cx}
        y={cy - 12}
        textAnchor="middle"
        dominantBaseline="central"
        fill="hsl(var(--popover-foreground))"
        fontSize={10}
        fontFamily="ui-monospace, monospace"
      >
        {value}
      </text>
    </g>
  );
};

StepTooltipLabel.propTypes = {
  viewBox: PropTypes.object,
  value: PropTypes.string,
};

/** Custom Recharts tooltip showing supply and price at cursor */
const CurveTooltip = ({ active, payload, t }) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover text-popover-foreground border border-border rounded-lg p-2 shadow-lg text-xs font-mono">
      <div>
        {t("supply")}: {Math.round(data.supply)}
      </div>
      <div>
        {t("common:price")}: {data.price.toFixed(4)} SOF
      </div>
    </div>
  );
};

CurveTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  t: PropTypes.func,
};

/**
 * BondingCurvePanel
 * Visualizes stepped bonding curve using Recharts with responsive sizing.
 */
const BondingCurvePanel = ({
  curveSupply,
  curveStep,
  allBondSteps,
  compact = false,
  mini = false,
}) => {
  const { t } = useTranslation("raffle");
  const sofDecimals = useSofDecimals();
  const gradientId = useId();
  const [activeDot, setActiveDot] = useState(null);

  const formatSOF = (weiLike) => {
    try {
      return Number(formatUnits(weiLike ?? 0n, sofDecimals)).toFixed(4);
    } catch {
      return "0.0000";
    }
  };

  const maxSupply = useMemo(() => {
    try {
      const last =
        Array.isArray(allBondSteps) && allBondSteps.length > 0
          ? allBondSteps[allBondSteps.length - 1]
          : null;
      return last?.rangeTo ?? 0n;
    } catch {
      return 0n;
    }
  }, [allBondSteps]);

  const progressPct = useMemo(() => {
    try {
      if (!maxSupply || maxSupply === 0n) return 0;
      const pct = Number((curveSupply * 10000n) / maxSupply) / 100;
      return Math.min(100, Math.max(0, pct));
    } catch {
      return 0;
    }
  }, [curveSupply, maxSupply]);

  const currentPrice = useMemo(() => {
    try {
      return curveStep?.price ?? 0n;
    } catch {
      return 0n;
    }
  }, [curveStep]);

  // Build Recharts data: array of {supply, price}
  // Uses stepAfter interpolation — each point holds its price until the next.
  // Intermediate points are added within each step so the tooltip tracks
  // smoothly instead of snapping to step boundaries.
  const chartData = useMemo(() => {
    try {
      const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
      if (steps.length === 0) return [];
      const totalRange = Number(BigInt(steps[steps.length - 1]?.rangeTo ?? 0));
      if (totalRange <= 0) return [];
      // ~300 points across the full range for smooth tooltip tracking
      const resolution = Math.max(1, Math.floor(totalRange / 300));
      const pts = [];
      let prevRangeTo = 0;
      for (const s of steps) {
        const rangeTo = Number(BigInt(s?.rangeTo ?? 0));
        const price = Number(formatUnits(s?.price ?? 0n, sofDecimals));
        // First point at start of this step
        pts.push({ supply: prevRangeTo, price });
        // Intermediate points for smooth tooltip
        for (let x = prevRangeTo + resolution; x < rangeTo; x += resolution) {
          pts.push({ supply: x, price });
        }
        prevRangeTo = rangeTo;
      }
      // Final point at the end of the last step
      const lastPrice = Number(formatUnits(steps[steps.length - 1]?.price ?? 0n, sofDecimals));
      pts.push({ supply: prevRangeTo, price: lastPrice });
      return pts;
    } catch {
      return [];
    }
  }, [allBondSteps, sofDecimals]);

  // Step boundary dots at midpoint of each horizontal segment
  const stepDots = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    if (steps.length === 0) return [];
    const dots = [];
    let prevRangeTo = 0n;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const rangeTo = BigInt(s?.rangeTo ?? 0);
      const price = Number(formatUnits(s?.price ?? 0n, sofDecimals));
      const mid = (Number(prevRangeTo) + Number(rangeTo)) / 2;
      dots.push({ supply: mid, price, step: Number(s?.step ?? i + 1) });
      prevRangeTo = rangeTo;
    }
    const count = dots.length;
    if (count <= 15) return dots;
    const stride = Math.ceil(count / 15);
    return dots.filter((_, idx) => idx % stride === 0 || idx === count - 1);
  }, [allBondSteps, sofDecimals]);

  const currentSupply = Number(curveSupply ?? 0n);

  // Price at current supply (for the orange marker dot)
  const priceAtSupply = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    for (const s of steps) {
      if (currentSupply <= Number(BigInt(s?.rangeTo ?? 0))) {
        return Number(formatUnits(s?.price ?? 0n, sofDecimals));
      }
    }
    if (steps.length > 0) {
      return Number(formatUnits(steps[steps.length - 1]?.price ?? 0n, sofDecimals));
    }
    return 0;
  }, [allBondSteps, currentSupply, sofDecimals]);

  // Build steps array for Progress component (full mode only)
  // Dots are evenly spaced across the bar (0% to 100%), each showing its
  // step's price. This keeps the visual clean regardless of step range sizes.
  const progressSteps = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    if (steps.length === 0 || !maxSupply || maxSupply === 0n) return [];
    const count = steps.length;
    const stride = count > 40 ? Math.ceil(count / 40) : 1;
    const included = steps.filter(
      (_, idx) => idx % stride === 0 || idx === count - 1,
    );
    const n = included.length;
    return included.map((s, idx) => {
      const pos = n <= 1 ? 0 : (idx / (n - 1)) * 100;
      const rawPrice = Number(formatUnits(s.price ?? 0n, sofDecimals));
      const price = (Math.ceil(rawPrice * 10) / 10).toFixed(1);
      const stepNum = s?.step ?? idx;
      return {
        position: pos,
        label: `${price} SOF`,
        sublabel: `${t("step")} #${stepNum}`,
      };
    });
  }, [allBondSteps, maxSupply, sofDecimals, t]);

  const safeGradientId = gradientId.replace(/:/g, "_");

  // Chart height by mode
  const chartHeight = mini ? "100%" : compact ? 200 : 320;

  // Margins by mode
  const chartMargin = mini
    ? { top: 4, right: 4, bottom: 4, left: 4 }
    : compact
      ? { top: 8, right: 8, bottom: 8, left: -20 }
      : { top: 10, right: 16, bottom: 24, left: -10 };

  const containerClassName = mini ? "h-full" : "space-y-4";
  const graphWrapperClassName = mini
    ? "w-full h-full"
    : "w-full overflow-hidden border rounded p-2 bg-background";

  if (chartData.length === 0) {
    return (
      <div className={containerClassName}>
        <div className={graphWrapperClassName}>
          {mini ? (
            <Skeleton className="w-full h-full rounded-none" />
          ) : (
            <div className="text-sm text-muted-foreground">
              {t("noBondingCurveData")}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <div className={graphWrapperClassName}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <AreaChart
            data={chartData}
            margin={chartMargin}
            style={{ outline: "none" }}
          >
            <defs>
              <linearGradient id={safeGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(var(--primary))"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(var(--primary))"
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>

            {/* Grid — visible in full/compact, hidden in mini */}
            {!mini && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                strokeOpacity={0.5}
              />
            )}

            <XAxis
              dataKey="supply"
              type="number"
              hide={mini}
              tick={compact ? false : { fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={!mini}
              stroke="hsl(var(--border))"
              label={
                !compact && !mini
                  ? {
                      value: t("supplyTickets"),
                      position: "insideBottom",
                      offset: -16,
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    }
                  : undefined
              }
            />
            <YAxis
              hide={mini}
              tick={compact ? false : { fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={!mini}
              stroke="hsl(var(--border))"
              domain={[0, "auto"]}
              label={
                !compact && !mini
                  ? {
                      value: t("priceSof"),
                      angle: -90,
                      position: "insideLeft",
                      offset: 20,
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    }
                  : undefined
              }
            />

            {/* Cursor tooltip — full mode only */}
            {!compact && !mini && (
              <Tooltip
                content={<CurveTooltip t={t} />}
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
              />
            )}

            <Area
              type="stepAfter"
              dataKey="price"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill={`url(#${safeGradientId})`}
              isAnimationActive={false}
              activeDot={false}
            />

            {/* Step boundary dots */}
            {stepDots.map((dot, idx) => (
              <ReferenceDot
                key={`step-${dot.step}`}
                x={dot.supply}
                y={dot.price}
                r={mini ? 2 : 3}
                fill="hsl(var(--primary))"
                stroke="hsl(var(--background))"
                strokeWidth={1.5}
                style={{ cursor: mini ? undefined : "pointer" }}
                onClick={
                  !mini
                    ? (e) => {
                        e?.stopPropagation?.();
                        setActiveDot(activeDot === idx ? null : idx);
                      }
                    : undefined
                }
                label={
                  activeDot === idx
                    ? <StepTooltipLabel value={`${(Math.ceil(dot.price * 10) / 10).toFixed(1)} SOF`} />
                    : undefined
                }
              />
            ))}

            {/* Current supply marker — orange dashed line */}
            {currentSupply > 0 && (
              <ReferenceLine
                x={currentSupply}
                stroke="#f97316"
                strokeDasharray={mini ? "2 4" : "4 3"}
                strokeWidth={1.5}
              />
            )}
            {/* Current supply dot */}
            {currentSupply > 0 && priceAtSupply > 0 && (
              <ReferenceDot
                x={currentSupply}
                y={priceAtSupply}
                r={mini ? 3 : 4}
                fill="#f97316"
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats and progress bar — full mode only */}
      {!compact && !mini && (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-2 border rounded">
              <div className="text-primary">{t("currentStep")}</div>
              <div className="font-mono text-lg">
                {curveStep?.step?.toString?.() ?? "0"}
              </div>
            </div>
            <div className="p-2 border rounded">
              <div className="text-primary">{t("currentPrice")}</div>
              <div className="font-mono text-lg">{formatSOF(currentPrice)}</div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm text-primary mb-1">
              <span>{t("bondingCurveProgress")}</span>
              <span>{progressPct.toFixed(2)}%</span>
            </div>
            <Progress
              value={progressPct}
              steps={progressSteps}
              className="h-3"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>
                {t("supply")}: {curveSupply?.toString?.() ?? "0"}
              </span>
              <span>{maxSupply?.toString?.() ?? "0"} max</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

BondingCurvePanel.propTypes = {
  curveSupply: PropTypes.any,
  curveStep: PropTypes.object,
  allBondSteps: PropTypes.array,
  compact: PropTypes.bool,
  mini: PropTypes.bool,
};

export default BondingCurvePanel;
