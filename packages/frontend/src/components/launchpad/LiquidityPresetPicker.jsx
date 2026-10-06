// src/components/launchpad/LiquidityPresetPicker.jsx
//
// The launch form's "Liquidity" field: one card per liquidity preset, as a radio
// group (arrow keys, Home and End move the choice; only the chosen card is in the
// tab order). Each card shows the preset's name, a one-line description, a small
// depth chart and where the supply sits, all from lib/liquidityPresets.js.
//
// The chart borrows the raffle bonding-curve editor's look (GraphView /
// MiniCurveChart): a primary stroke over a faint primary fill. Its x axis is the
// price, log scale, from the launch price to DEPTH_CHART_MAX_MULTIPLE; its height
// is a band's depth on one scale shared by every preset, so the cards compare.

import { useId, useRef } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEPTH_CHART_MAX_MULTIPLE,
  LIQUIDITY_PRESETS,
  presetDepthSegments,
  presetDescriptionKey,
  presetLadder,
  presetNameKey,
} from "@/lib/liquidityPresets";

const W = 100;
const H = 28;
const TOP = 2;

/** The preset's depth as a stepped area: fill path and top outline. */
function depthPaths(id) {
  const segments = presetDepthSegments(id);
  const y = (h) => (H - h * (H - TOP)).toFixed(2);
  const top = segments.map((s, i) => `${i ? "L" : "M"}${(s.x0 * W).toFixed(2)},${y(s.height)} L${(s.x1 * W).toFixed(2)},${y(s.height)}`);
  const outline = top.join(" ");
  return { outline, fill: `M0,${H} ${outline.replace(/^M/, "L")} L${W},${H} Z` };
}

const DepthChart = ({ id }) => {
  const { outline, fill } = depthPaths(id);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true" focusable="false">
      <line x1="0" y1={H} x2={W} y2={H} stroke="hsl(var(--border))" vectorEffect="non-scaling-stroke" />
      <path d={fill} fill="hsl(var(--primary))" fillOpacity={0.15} />
      <path d={outline} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

DepthChart.propTypes = { id: PropTypes.number.isRequired };

/** A multiple of the launch price as the copy shows it: 1, 3, 30. */
const multiple = (m) => String(Math.round(m));

const LiquidityPresetPicker = ({ value, onChange }) => {
  const { t } = useTranslation("launchpad");
  const baseId = useId();
  const refs = useRef([]);

  const shares = (id) =>
    presetLadder(id)
      .map((b) =>
        b.to === Infinity
          ? t("liquidityPresets.bandLast", { share: Math.round(b.share * 100), from: multiple(b.from) })
          : t("liquidityPresets.band", { share: Math.round(b.share * 100), from: multiple(b.from), to: multiple(b.to) }),
      )
      .join(` ${t("liquidityPresets.separator")} `);

  const choose = (index) => {
    const preset = LIQUIDITY_PRESETS[(index + LIQUIDITY_PRESETS.length) % LIQUIDITY_PRESETS.length];
    onChange(preset.id);
    refs.current[preset.id]?.focus();
  };

  const onKeyDown = (index) => (e) => {
    const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: -1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    choose(moves[e.key]);
  };

  // Something must be tabbable even if the value is not a known preset.
  const selected = LIQUIDITY_PRESETS.some((p) => p.id === value) ? value : LIQUIDITY_PRESETS[0].id;

  return (
    <div className="space-y-2">
      <Label id={`${baseId}-label`}>{t("form.liquidity")}</Label>
      <div role="radiogroup" aria-labelledby={`${baseId}-label`} className="grid gap-2 sm:grid-cols-2">
        {LIQUIDITY_PRESETS.map((preset, index) => {
          const checked = preset.id === value;
          const id = `${baseId}-${preset.key}`;
          return (
            <button
              key={preset.id}
              ref={(el) => {
                refs.current[preset.id] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-labelledby={`${id}-name`}
              aria-describedby={`${id}-description ${id}-shares`}
              tabIndex={preset.id === selected ? 0 : -1}
              onClick={() => onChange(preset.id)}
              onKeyDown={onKeyDown(index)}
              data-testid={`liquidity-preset-${preset.key}`}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
                checked ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/50",
              )}
            >
              <span id={`${id}-name`} className="text-sm font-medium text-foreground">
                {t(presetNameKey(preset))}
              </span>
              <span id={`${id}-description`} className="text-xs text-muted-foreground">
                {t(presetDescriptionKey(preset))}
              </span>
              <DepthChart id={preset.id} />
              <span id={`${id}-shares`} className="text-[11px] text-muted-foreground">
                {shares(preset.id)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("form.liquidityHelp", { max: DEPTH_CHART_MAX_MULTIPLE })}
      </p>
      <p className="text-xs text-muted-foreground">{t("form.liquidityFootnote")}</p>
    </div>
  );
};

LiquidityPresetPicker.propTypes = {
  value: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default LiquidityPresetPicker;
