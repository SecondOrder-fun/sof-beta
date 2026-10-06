// src/lib/liquidityPresets.js
//
// The liquidity presets a launch can be placed with — the frontend's one source
// for their ids, names and descriptions (i18n keys, translated by components) and
// ladders. It mirrors UniV4LiquidityPlacer.presetBands(preset) and must match it:
// tests/lib/liquidityPresets.test.js reads the shares and tick offsets out of the
// contract's source.
//
// A preset is one to three single-sided positions ("bands") laid end to end from
// the launch price, each holding a share of the supply. A band's end is a tick
// offset from the starting price — 2× = 6,932 ticks, 3× = 10,987, 30× = 34,013
// (ln(m) / ln(1.0001)) — snapped to the pool's tick spacing when placed. The last
// band always runs to the end of v4's price scale, so no preset ever sells out.
//
// "Depth" here is a band's liquidity relative to Classic's: how much the price
// moves for a given trade inside it (deeper = calmer). The supply is a fixed
// budget, so a preset deeper than Classic somewhere is thinner somewhere else.

/** presetBands' `type(uint24).max`: the band runs to the end of the price scale. */
export const PRESET_EDGE = 0xffffff;
/** Ticks from the starting price to 2×, 3× and 30× (UniV4LiquidityPlacer.TICKS_*). */
export const TICKS_2X = 6_932;
export const TICKS_3X = 10_987;
export const TICKS_30X = 34_013;

/**
 * Every preset, by its on-chain id (`liquidityPreset`, uint8). `ends` are tick
 * offsets from the start where each band ends; `sharesBps` its share of the supply.
 */
export const LIQUIDITY_PRESETS = Object.freeze(
  [
    { id: 0, key: 'classic', ends: [PRESET_EDGE], sharesBps: [10_000] },
    { id: 1, key: 'steadyStart', ends: [TICKS_3X, TICKS_30X, PRESET_EDGE], sharesBps: [3_000, 5_500, 1_500] },
    { id: 2, key: 'thickMiddle', ends: [TICKS_3X, TICKS_30X, PRESET_EDGE], sharesBps: [1_500, 5_500, 3_000] },
    { id: 3, key: 'wideOpen', ends: [TICKS_2X, PRESET_EDGE], sharesBps: [4_000, 6_000] },
  ].map((p) => Object.freeze({ ...p, ends: Object.freeze(p.ends), sharesBps: Object.freeze(p.sharesBps) })),
);

/** The preset a launch starts with in the form: Classic. */
export const DEFAULT_LIQUIDITY_PRESET = 0;

/**
 * The preset with this on-chain id, or null for anything else (missing, unknown,
 * not an integer). Takes a number, a bigint or a numeric string (an API row).
 * @param {number | bigint | string | null | undefined} id
 */
export function liquidityPreset(id) {
  if (id == null || id === '') return null;
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return LIQUIDITY_PRESETS.find((p) => p.id === n) ?? null;
}

/** i18n keys (launchpad namespace) for a preset's name and one-line description. */
export const presetNameKey = (preset) => `liquidityPresets.${preset.key}.name`;
export const presetDescriptionKey = (preset) => `liquidityPresets.${preset.key}.description`;

/**
 * Each band's tick offsets from the starting price as the placer lays them
 * (UniV4LiquidityPlacer._ladder): an end is snapped to the nearest multiple of the
 * spacing, at least one spacing past the band's start; the last band's end is
 * null — the end of the price scale. Ticks move away from the start in the buy's
 * direction (down for a quote that is currency0, up for a token that is).
 * @param {number} id
 * @param {number} tickSpacing
 * @returns {{ from: number, to: number | null }[]}
 */
export function presetTickOffsets(id, tickSpacing) {
  const preset = liquidityPreset(id);
  if (!preset) return [];
  const s = Number(tickSpacing);
  let from = 0;
  return preset.ends.map((end, i) => {
    const last = i === preset.ends.length - 1;
    let to = null;
    if (!last) {
      to = Math.trunc((end + Math.trunc(s / 2)) / s) * s;
      if (to <= from) to = from + s;
    }
    const band = { from, to };
    if (to != null) from = to;
    return band;
  });
}

/** The price multiple `ticks` from the start: 1.0001^ticks. */
const multipleOf = (ticks) => 1.0001 ** ticks;

/**
 * A preset's bands in price multiples of the launch price, unsnapped: where each
 * starts and ends (`to` is Infinity for the last), its share of the supply (0..1)
 * and its depth relative to Classic.
 *
 * A single-sided band holds L·(1/√m_from − 1/√m_to) of the supply in launch-price
 * multiples (Classic, one band from 1× to the end, holds all of it with L = 1), so
 * a band with share s has depth s / (1/√m_from − 1/√m_to).
 * @param {number} id
 * @returns {{ from: number, to: number, share: number, depth: number }[]}
 */
export function presetLadder(id) {
  const preset = liquidityPreset(id);
  if (!preset) return [];
  let from = 1;
  return preset.ends.map((end, i) => {
    const to = end === PRESET_EDGE ? Infinity : multipleOf(end);
    const share = preset.sharesBps[i] / 10_000;
    const span = 1 / Math.sqrt(from) - (to === Infinity ? 0 : 1 / Math.sqrt(to));
    const band = { from, to, share, depth: share / span };
    from = to;
    return band;
  });
}

/** The deepest band of any preset — a shared scale, so the presets' charts compare. */
export const MAX_PRESET_DEPTH = Math.max(...LIQUIDITY_PRESETS.flatMap((p) => presetLadder(p.id).map((b) => b.depth)));

/** The depth chart's right edge, as a multiple of the launch price. */
export const DEPTH_CHART_MAX_MULTIPLE = 100;

/**
 * A preset's depth as segments for a small chart over a log price axis from 1× to
 * `maxMultiple`: `x0`/`x1` in 0..1 along the axis, `height` 0..1 on the shared
 * MAX_PRESET_DEPTH scale. The last band runs off the right edge (it never ends).
 * @param {number} id
 * @param {number} [maxMultiple=DEPTH_CHART_MAX_MULTIPLE]
 * @returns {{ x0: number, x1: number, height: number, share: number }[]}
 */
export function presetDepthSegments(id, maxMultiple = DEPTH_CHART_MAX_MULTIPLE) {
  const span = Math.log(maxMultiple);
  const x = (m) => Math.min(1, Math.log(m) / span);
  return presetLadder(id)
    .filter((b) => b.from < maxMultiple)
    .map((b) => ({ x0: x(b.from), x1: x(b.to), height: b.depth / MAX_PRESET_DEPTH, share: b.share }));
}
