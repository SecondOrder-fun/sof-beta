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
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      xC = width / 2;
      yC = height / 2;
    };
    resize();
    window.addEventListener("resize", resize);

    if (prefersReducedMotion) {
      const { grid, maxIndex } = buildGrid();
      for (let i = 0; i < 60; i++) {
        const p = createParticle(grid, maxIndex);
        const xx = xC + p.x * ZOOM;
        const yy = yC + p.y * ZOOM;
        ctx.beginPath();
        ctx.arc(xx, yy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.h}, ${p.s}%, ${p.l}%, 0.25)`;
        ctx.fill();
      }
      return () => window.removeEventListener("resize", resize);
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
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Attractor dot
        const attrac = toCanvas(
          grid[p.attractor.gridSpotIndex].x,
          grid[p.attractor.gridSpotIndex].y,
        );
        ctx.beginPath();
        ctx.arc(attrac.x, attrac.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.h}, ${p.s}%, ${p.l}%, ${DOT_ALPHA})`;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
};

export default MeltyLines;
