// src/components/backgrounds/MeltyLines.jsx
import { useEffect, useRef } from "react";

/**
 * Particle trail background — canvas-based flowing particles
 * that wander a radial field and leave brand-colored trails.
 *
 * Inspired by https://codepen.io/alexandrix/pen/oQOvYp (Alex Andrix, 2018).
 * Rewritten for React with SecondOrder.fun brand palette,
 * no external dependencies, and reduced-motion support.
 *
 * The canvas is fully transparent — trails are drawn with low alpha
 * so page content always shows through.
 */

// ── Brand palette (HSL values matching CSS vars) ──
const PALETTE = [
  { h: 343, s: 66, l: 47 }, // Cochineal Red (--gradient-brand / --primary)
  { h: 352, s: 70, l: 64 }, // Fabric Red   (--gradient-rose)
  { h: 0, s: 25, l: 74 },   // Dusty Rose   (--gradient-dusty)
  { h: 346, s: 66, l: 91 }, // Pastel Rose  (--gradient-blush)
  { h: 20, s: 9, l: 63 },   // Cement       (--gradient-taupe)
];

// ── Constants ──
const GRID_SIZE = 8;
const GRID_RANGE = 500;
const GRID_STEPS = Math.floor((GRID_RANGE * 2) / GRID_SIZE);
const MAX_POP = 300;
const LIFESPAN = 1000;
const BIRTH_FREQ = 2;
const SPRING_K = 3;
const VISCOSITY = 0.3;
const ZOOM = 2.16; // 1.6 * 1.35 — scaled up 35%
const STUCK_LIMIT = 10;
const BUSY_FADE = 15;
const CHAOS = 30;
const TRAIL_LENGTH = 12;
const TRAIL_ALPHA = 0.35;
const DOT_ALPHA = 0.5;

// 4x4 pixelated dot — blank corners give it a soft "circular" silhouette
// at low resolution. Each cell is rendered as a `PIXEL_SIZE` × `PIXEL_SIZE`
// square, so the full dot is 4*PIXEL_SIZE on a side. With PIXEL_SIZE = 3,
// the dot is 12px — about 8× the original 1.5px attractor circle.
const PIXEL_SIZE = 3;
const TRAIL_WIDTH = 8; // ~6× the original 1.5 px stroke
// 1 = filled, 0 = blank. Corners blank → rounded silhouette.
const PIXEL_DOT_PATTERN = [
  [0, 1, 1, 0],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [0, 1, 1, 0],
];

/**
 * Render the 4x4 pixelated dot centered on (cx, cy). Each filled cell is
 * a `PIXEL_SIZE`-px square, rasterized to the canvas grid so the look is
 * crisp regardless of the underlying transform.
 */
function drawPixelDot(ctx, cx, cy, h, s, l, alpha) {
  ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  // Top-left of the dot in canvas coords; round to integer to keep
  // edges sharp (avoids viewport-fractional anti-aliasing softening
  // the pixel-art aesthetic).
  const originX = Math.round(cx - PIXEL_SIZE * 2);
  const originY = Math.round(cy - PIXEL_SIZE * 2);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      if (PIXEL_DOT_PATTERN[row][col] === 1) {
        ctx.fillRect(
          originX + col * PIXEL_SIZE,
          originY + row * PIXEL_SIZE,
          PIXEL_SIZE,
          PIXEL_SIZE,
        );
      }
    }
  }
}

function buildGrid() {
  const grid = [];
  let i = 0;
  for (let xx = -GRID_RANGE; xx < GRID_RANGE; xx += GRID_SIZE) {
    for (let yy = -GRID_RANGE; yy < GRID_RANGE; yy += GRID_SIZE) {
      // Flat field with gentle noise — particles spread evenly
      const field = 200 + 55 * Math.sin(xx * 0.02) * Math.cos(yy * 0.02);

      const isEdge =
        xx === -GRID_RANGE
          ? "left"
          : xx === -GRID_RANGE + GRID_SIZE * (GRID_STEPS - 1)
            ? "right"
            : yy === -GRID_RANGE
              ? "top"
              : yy === -GRID_RANGE + GRID_SIZE * (GRID_STEPS - 1)
                ? "bottom"
                : false;

      grid.push({ x: xx, y: yy, busyAge: 0, spotIndex: i, isEdge, field });
      i++;
    }
  }
  return { grid, maxIndex: i };
}

function createParticle(grid, maxIndex) {
  const spotIndex = Math.floor(Math.random() * maxIndex);
  const spot = grid[spotIndex];
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  return {
    h: color.h,
    s: color.s,
    l: color.l + Math.floor(Math.random() * 15 - 7),
    x: spot.x,
    y: spot.y,
    xSpeed: 0,
    ySpeed: 0,
    age: 0,
    ageSinceStuck: 0,
    attractor: { oldIndex: spotIndex, gridSpotIndex: spotIndex },
    trail: [{ x: spot.x, y: spot.y }],
    alive: true,
  };
}

function maxByField(spots) {
  let best = spots[0];
  let bestVal = -Infinity;
  for (const s of spots) {
    if (!s) continue;
    const v = s.field + CHAOS * Math.random();
    if (v > bestVal) {
      bestVal = v;
      best = s;
    }
  }
  return best;
}

const MeltyLines = () => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const ctx = canvas.getContext("2d");
    let width, height, xC, yC;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      // Measure the canvas's actual rendered size (set by the
      // `absolute inset-0` parent) rather than the window. Otherwise
      // particles get centered to the viewport midpoint instead of the
      // section midpoint, leaving them clipped at the bottom.
      const rect = canvas.getBoundingClientRect();
      width = rect.width || window.innerWidth;
      height = rect.height || window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      xC = width / 2;
      yC = height / 2;
    };
    resize();
    window.addEventListener("resize", resize);
    // Container can change size after mount (font load, layout shift).
    // ResizeObserver re-measures so the canvas stays in lockstep.
    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(resize);
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    }

    if (prefersReducedMotion) {
      const { grid, maxIndex } = buildGrid();
      for (let i = 0; i < 60; i++) {
        const p = createParticle(grid, maxIndex);
        const xx = xC + p.x * ZOOM;
        const yy = yC + p.y * ZOOM;
        drawPixelDot(ctx, xx, yy, p.h, p.s, p.l, 0.25);
      }
      return () => {
        window.removeEventListener("resize", resize);
        if (resizeObserver) resizeObserver.disconnect();
      };
    }

    // ── Animated mode ──
    const { grid, maxIndex } = buildGrid();
    let particles = [];
    let stepCount = 0;

    const toCanvas = (x, y) => ({
      x: xC + x * ZOOM,
      y: yC + y * ZOOM,
    });

    const frame = () => {
      stepCount++;

      // Age grid
      for (const cell of grid) {
        if (cell.busyAge > 0) cell.busyAge++;
      }

      // Birth
      if (stepCount % BIRTH_FREQ === 0 && particles.length < MAX_POP) {
        particles.push(createParticle(grid, maxIndex));
      }

      // Move
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        const index = p.attractor.gridSpotIndex;
        let gridSpot = grid[index];

        if (Math.random() < 0.25) {
          if (!gridSpot.isEdge) {
            const top = grid[index - 1];
            const bottom = grid[index + 1];
            const left = grid[index - GRID_STEPS];
            const right = grid[index + GRID_STEPS];
            const candidates = [top, bottom, left, right].filter(Boolean);
            const best = maxByField(candidates);

            if (best && (best.busyAge === 0 || best.busyAge > BUSY_FADE)) {
              p.ageSinceStuck = 0;
              p.attractor.oldIndex = index;
              p.attractor.gridSpotIndex = best.spotIndex;
              gridSpot = best;
              gridSpot.busyAge = 1;
            } else {
              p.ageSinceStuck++;
            }
          } else {
            p.ageSinceStuck++;
          }

          if (p.ageSinceStuck >= STUCK_LIMIT) {
            p.alive = false;
          }
        }

        // Spring physics
        const dx = p.x - gridSpot.x;
        const dy = p.y - gridSpot.y;
        p.xSpeed = (p.xSpeed + -SPRING_K * dx) * VISCOSITY;
        p.ySpeed = (p.ySpeed + -SPRING_K * dy) * VISCOSITY;
        p.x += 0.05 * p.xSpeed;
        p.y += 0.05 * p.ySpeed;
        p.age++;

        // Record trail
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > TRAIL_LENGTH) p.trail.shift();

        if (p.age > LIFESPAN) p.alive = false;
      }

      // Remove dead
      particles = particles.filter((p) => p.alive);

      // ── Draw ──
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        const trail = p.trail;
        if (trail.length < 2) continue;

        for (let t = 1; t < trail.length; t++) {
          const from = toCanvas(trail[t - 1].x, trail[t - 1].y);
          const to = toCanvas(trail[t].x, trail[t].y);
          const alpha = TRAIL_ALPHA * (t / trail.length);

          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.strokeStyle = `hsla(${p.h}, ${p.s}%, ${p.l}%, ${alpha})`;
          // Square caps + bumped width to match the chunkier pixel-art
          // dot. Round caps would soften the trail back to the old
          // smooth-line look we're moving away from.
          ctx.lineCap = "square";
          ctx.lineWidth = TRAIL_WIDTH;
          ctx.stroke();
        }

        // Attractor "dot" — 4x4 pixelated block with blank corners.
        const attrac = toCanvas(
          grid[p.attractor.gridSpotIndex].x,
          grid[p.attractor.gridSpotIndex].y,
        );
        drawPixelDot(ctx, attrac.x, attrac.y, p.h, p.s, p.l, DOT_ALPHA);
      }

      animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      // `absolute` so the canvas fills its nearest positioned ancestor only —
      // keeps the particles inside the Home content area instead of bleeding
      // across the global Header/Footer (which previously happened with
      // `fixed inset-0`). Callers must wrap MeltyLines in a `relative`
      // container with a definite height.
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
};

export default MeltyLines;
