// src/components/curve/MiniCurveChart.jsx
import PropTypes from "prop-types";
import { useId, useMemo, useState } from "react";
import { formatUnits } from "viem";
import {
  AreaChart,
  Area,
  XAxis,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

/** SVG tooltip rendered above the active step dot */
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

/**
 * MiniCurveChart
 * Responsive mini bonding curve visualization using Recharts.
 * Renders a stepped area chart that fills its container.
 */
const MiniCurveChart = ({ curveSupply, allBondSteps, currentStep: _currentStep }) => {
  const gradientId = useId();
  const [activeDot, setActiveDot] = useState(null);

  const chartData = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    if (steps.length === 0) return [];

    const pts = [];
    let prevX = 0n;
    for (const s of steps) {
      const x2 = BigInt(s?.rangeTo ?? 0);
      const price = Number(formatUnits(s?.price ?? 0n, 18));
      // Start of step segment
      pts.push({ supply: Number(prevX), price });
      // End of step segment
      pts.push({ supply: Number(x2), price });
      prevX = x2;
    }
    return pts;
  }, [allBondSteps]);

  // Dots placed at the midpoint of each horizontal step segment
  const stepDots = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    if (steps.length === 0) return [];
    const dots = [];
    let prevRangeTo = 0n;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const rangeTo = BigInt(s?.rangeTo ?? 0);
      const price = Number(formatUnits(s?.price ?? 0n, 18));
      const mid = (Number(prevRangeTo) + Number(rangeTo)) / 2;
      dots.push({ supply: mid, price, step: Number(s?.step ?? i + 1) });
      prevRangeTo = rangeTo;
    }
    // Thin out if too many dots
    const count = dots.length;
    if (count <= 15) return dots;
    const stride = Math.ceil(count / 15);
    return dots.filter((_, idx) => idx % stride === 0 || idx === count - 1);
  }, [allBondSteps]);

  const currentSupply = Number(curveSupply ?? 0n);

  // Find the price at current supply by walking the steps
  const priceAtSupply = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    for (const s of steps) {
      if (currentSupply <= Number(BigInt(s?.rangeTo ?? 0))) {
        return Number(formatUnits(s?.price ?? 0n, 18));
      }
    }
    if (steps.length > 0) {
      return Number(formatUnits(steps[steps.length - 1]?.price ?? 0n, 18));
    }
    return 0;
  }, [allBondSteps, currentSupply]);

  if (chartData.length === 0) {
    return <Skeleton className="w-full h-full rounded-none" />;
  }

  const safeGradientId = gradientId.replace(/:/g, "_");

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={chartData}
        margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
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
        <XAxis dataKey="supply" type="number" hide />
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
            r={3}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--background))"
            strokeWidth={1.5}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e?.stopPropagation?.();
              setActiveDot(activeDot === idx ? null : idx);
            }}
            label={
              activeDot === idx
                ? <StepTooltipLabel value={`${(Math.ceil(dot.price * 10) / 10).toFixed(1)} SOF`} />
                : undefined
            }
          />
        ))}
        {/* Current supply marker */}
        {currentSupply > 0 && (
          <ReferenceLine
            x={currentSupply}
            stroke="#f97316"
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />
        )}
        {currentSupply > 0 && priceAtSupply > 0 && (
          <ReferenceDot
            x={currentSupply}
            y={priceAtSupply}
            r={4}
            fill="#f97316"
            stroke="hsl(var(--background))"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
};

MiniCurveChart.propTypes = {
  curveSupply: PropTypes.any,
  allBondSteps: PropTypes.array,
  currentStep: PropTypes.object,
};

export default MiniCurveChart;
