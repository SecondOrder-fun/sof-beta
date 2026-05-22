import confetti from 'canvas-confetti';

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
    colors: ['#ffd45a', '#ff8a3d', '#a78bfa', '#34d399', '#60a5fa'],
  });
  confetti({
    particleCount: perSide,
    angle: 120,
    spread: 70,
    startVelocity: 55,
    origin: { x: 1, y: 0.7 },
    colors: ['#ffd45a', '#ff8a3d', '#a78bfa', '#34d399', '#60a5fa'],
  });
}

export function reset() {
  if (typeof confetti.reset === 'function') confetti.reset();
}
