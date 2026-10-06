import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_LIQUIDITY_PRESET,
  LIQUIDITY_PRESETS,
  MAX_PRESET_DEPTH,
  PRESET_EDGE,
  TICKS_2X,
  TICKS_3X,
  TICKS_30X,
  liquidityPreset,
  presetDepthSegments,
  presetDescriptionKey,
  presetLadder,
  presetNameKey,
  presetTickOffsets,
} from "@/lib/liquidityPresets";

// The table must be UniV4LiquidityPlacer.presetBands to the tick and basis point.
// It is read out of the contract's own source, so a change there fails here.
const SOURCE = readFileSync(resolve(__dirname, "../../../contracts/src/launchpad/UniV4LiquidityPlacer.sol"), "utf8");
const num = (s) => Number(s.replaceAll("_", ""));
const tuple = (s) => s.split(",").map((x) => x.trim());
const match = (re) => {
  const m = SOURCE.match(re);
  if (!m) throw new Error(`not found in UniV4LiquidityPlacer.sol: ${re}`);
  return m;
};

const CONTRACT = (() => {
  const ids = Object.fromEntries(
    [...SOURCE.matchAll(/uint8 public constant PRESET_(\w+) = (\d+);/g)].map(([, name, id]) => [name, Number(id)]),
  );
  const ticks = Object.fromEntries(
    [...SOURCE.matchAll(/uint24 private constant (TICKS_\w+) = ([\d_]+);/g)].map(([, name, v]) => [name, num(v)]),
  );
  match(/uint24 edge = type\(uint24\)\.max;/);
  const end = (name) => (name === "edge" ? PRESET_EDGE : ticks[name]);
  const classicShare = num(match(/\(ends\[0\], sharesBps\[0\]\) = \(edge, ([\d_]+)\)/)[1]);
  const threeEnds = tuple(match(/\(ends\[0\], ends\[1\], ends\[2\]\) = \(([\w, ]+)\)/)[1]).map(end);
  const [, steady, thick] = match(/preset == PRESET_STEADY_START \? \(([\d_, ]+)\) : \(([\d_, ]+)\)/);
  const wideEnds = tuple(match(/\(ends\[0\], ends\[1\]\) = \(([\w, ]+)\)/)[1]).map(end);
  const wideShares = tuple(match(/\(sharesBps\[0\], sharesBps\[1\]\) = \(([\d_, ]+)\)/)[1]).map(num);
  return {
    ids,
    ticks,
    presets: {
      [ids.CLASSIC]: { ends: [PRESET_EDGE], sharesBps: [classicShare] },
      [ids.STEADY_START]: { ends: threeEnds, sharesBps: tuple(steady).map(num) },
      [ids.THICK_MIDDLE]: { ends: threeEnds, sharesBps: tuple(thick).map(num) },
      [ids.WIDE_OPEN]: { ends: wideEnds, sharesBps: wideShares },
    },
  };
})();

describe("the preset table matches UniV4LiquidityPlacer.presetBands", () => {
  it("has every preset the contract has, by id", () => {
    expect(LIQUIDITY_PRESETS.map((p) => p.id)).toEqual([0, 1, 2, 3]);
    expect(LIQUIDITY_PRESETS).toHaveLength(CONTRACT.ids.COUNT);
    expect(CONTRACT.ids).toMatchObject({ CLASSIC: 0, STEADY_START: 1, THICK_MIDDLE: 2, WIDE_OPEN: 3 });
  });

  it("uses the contract's tick offsets: 2× 6,932, 3× 10,987, 30× 34,013", () => {
    expect({ TICKS_2X, TICKS_3X, TICKS_30X }).toEqual(CONTRACT.ticks);
    expect([TICKS_2X, TICKS_3X, TICKS_30X]).toEqual([6_932, 10_987, 34_013]);
  });

  it.each(LIQUIDITY_PRESETS.map((p) => [p.key, p]))("%s: same ends and shares", (_key, preset) => {
    expect({ ends: [...preset.ends], sharesBps: [...preset.sharesBps] }).toEqual(CONTRACT.presets[preset.id]);
    expect(preset.sharesBps.reduce((a, b) => a + b, 0)).toBe(10_000);
    // The last band always runs to the end of the price scale.
    expect(preset.ends.at(-1)).toBe(PRESET_EDGE);
  });

  it("names the four presets as the contract docs do", () => {
    expect(LIQUIDITY_PRESETS.map((p) => p.key)).toEqual(["classic", "steadyStart", "thickMiddle", "wideOpen"]);
    expect(presetNameKey(LIQUIDITY_PRESETS[1])).toBe("liquidityPresets.steadyStart.name");
    expect(presetDescriptionKey(LIQUIDITY_PRESETS[3])).toBe("liquidityPresets.wideOpen.description");
    expect(DEFAULT_LIQUIDITY_PRESET).toBe(0);
  });
});

describe("liquidityPreset", () => {
  it("finds a preset by id from a number, bigint or numeric string", () => {
    expect(liquidityPreset(1)?.key).toBe("steadyStart");
    expect(liquidityPreset(2n)?.key).toBe("thickMiddle");
    expect(liquidityPreset("3")?.key).toBe("wideOpen");
    expect(liquidityPreset(0)?.key).toBe("classic");
  });

  it("is null for anything else", () => {
    for (const id of [null, undefined, "", 4, -1, 1.5, "x"]) expect(liquidityPreset(id)).toBeNull();
  });
});

describe("presetTickOffsets — UniV4LiquidityPlacer._ladder's snapping", () => {
  // The preset fixture (Steady start, spacing 200) placed its bands 11,000 and
  // 34,000 ticks below its 207200 start: [196200, 207200], [173200, 196200], ….
  it("snaps to the nearest multiple of the spacing", () => {
    expect(presetTickOffsets(1, 200)).toEqual([
      { from: 0, to: 11_000 },
      { from: 11_000, to: 34_000 },
      { from: 34_000, to: null },
    ]);
    expect(presetTickOffsets(3, 200)).toEqual([
      { from: 0, to: 7_000 },
      { from: 7_000, to: null },
    ]);
    expect(presetTickOffsets(2, 60)).toEqual([
      { from: 0, to: 10_980 },
      { from: 10_980, to: 34_020 },
      { from: 34_020, to: null },
    ]);
    expect(presetTickOffsets(0, 200)).toEqual([{ from: 0, to: null }]);
  });

  it("keeps each band at least one spacing wide", () => {
    expect(presetTickOffsets(1, 30_000)).toEqual([
      { from: 0, to: 30_000 },
      { from: 30_000, to: 60_000 },
      { from: 60_000, to: null },
    ]);
  });

  it("is empty for an unknown preset", () => {
    expect(presetTickOffsets(9, 200)).toEqual([]);
    expect(presetLadder(9)).toEqual([]);
  });
});

describe("presetLadder — shares and depth", () => {
  it("puts the bands at 1×, 3× and 30× of the launch price", () => {
    const [a, b, c] = presetLadder(1);
    expect(a.from).toBe(1);
    expect(a.to).toBeCloseTo(3, 3);
    expect(b.to).toBeCloseTo(30, 2);
    expect(c.to).toBe(Infinity);
    expect([a.share, b.share, c.share]).toEqual([0.3, 0.55, 0.15]);
  });

  it("gives Classic a depth of 1 everywhere", () => {
    expect(presetLadder(0)).toEqual([{ from: 1, to: Infinity, share: 1, depth: 1 }]);
  });

  // The copy, checked against the numbers.
  it("matches each description's shape", () => {
    const depth = (id) => presetLadder(id).map((b) => b.depth);
    const [s0, s1, s2] = depth(1);
    expect(s0).toBeLessThan(1); // Steady start: a light front…
    expect(s1).toBeGreaterThan(Math.max(s0, s2)); // …then the deepest middle
    const [t0, t1, t2] = depth(2);
    expect(t0).toBeLessThan(s0); // Thick middle: a fast first climb…
    expect(Math.min(t1, t2)).toBeGreaterThan(1); // …then calmer than Classic from 3× up
    const [w0, w1] = depth(3);
    expect(w0).toBeGreaterThan(1); // Wide open: deep at the launch price…
    expect(w1).toBeLessThan(w0); // …thinner later
    expect(MAX_PRESET_DEPTH).toBe(Math.max(...LIQUIDITY_PRESETS.flatMap((p) => depth(p.id))));
  });

  it("charts every preset on one scale, over a log axis from 1× to 100×", () => {
    const segments = presetDepthSegments(1);
    expect(segments.map((s) => s.x0)).toEqual([0, expect.closeTo(Math.log(3) / Math.log(100), 4), expect.closeTo(Math.log(30) / Math.log(100), 4)]);
    expect(segments.at(-1).x1).toBe(1);
    for (const p of LIQUIDITY_PRESETS) {
      for (const s of presetDepthSegments(p.id)) {
        expect(s.height).toBeGreaterThan(0);
        expect(s.height).toBeLessThanOrEqual(1);
      }
    }
  });
});
