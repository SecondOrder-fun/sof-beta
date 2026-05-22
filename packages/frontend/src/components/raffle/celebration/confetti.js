import confetti from 'canvas-confetti';

// canvas-confetti renders into a 2D canvas context; CSS custom properties cannot
// be resolved there, so colors are hardcoded hex by API constraint.
const BURST_COLORS = ['#ffd45a', '#ff8a3d', '#a78bfa', '#34d399', '#60a5fa'];

function isReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fireWinBurst({ scaled = false } = {}) {
  if (isReducedMotion()) return;
  const total = scaled ? 60 : 120;
  const perSide = Math.round(total / 2);
  confetti({
    particleCount: perSide,
    angle: 60,
    spread: 70,
    startVelocity: 55,
    origin: { x: 0, y: 0.7 },
    colors: BURST_COLORS,
  });
  confetti({
    particleCount: perSide,
    angle: 120,
    spread: 70,
    startVelocity: 55,
    origin: { x: 1, y: 0.7 },
    colors: BURST_COLORS,
  });
}

export function reset() {
  if (typeof confetti.reset === 'function') confetti.reset();
}
