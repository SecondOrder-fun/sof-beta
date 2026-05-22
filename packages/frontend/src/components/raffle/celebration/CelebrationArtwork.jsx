import PropTypes from 'prop-types';
import { motion } from 'framer-motion';

function useReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Rays({ animated }) {
  return (
    <svg
      data-element="rays"
      data-animated={animated ? 'true' : 'false'}
      viewBox="-50 -50 100 100"
      width="180"
      height="180"
      className="text-primary"
      style={{
        position: 'absolute',
        inset: '50% 50%',
        transform: 'translate(-50%, -50%)',
        animation: animated ? 'sof-rays-spin 8s linear infinite' : 'none',
      }}
      aria-hidden="true"
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <path
          key={i}
          d="M0 -45 L3 -10 L0 0 L-3 -10 Z"
          fill="currentColor"
          opacity="0.85"
          transform={`rotate(${i * 30})`}
        />
      ))}
      <style>{`@keyframes sof-rays-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}`}</style>
    </svg>
  );
}
Rays.propTypes = { animated: PropTypes.bool.isRequired };

function Ticket({ variant, label }) {
  const isCancelled = variant === 'cancelled';
  return (
    <motion.svg
      data-element="ticket"
      viewBox="-30 -15 60 30"
      width="120"
      height="60"
      className="text-card-foreground"
      initial={isCancelled ? { scale: 1, opacity: 1 } : { y: -60, scale: 0.6, opacity: 0 }}
      animate={isCancelled ? { scale: 0.7, opacity: 0.5 } : { y: 0, scale: 1, opacity: 1 }}
      transition={{ duration: isCancelled ? 0.7 : 0.5, ease: 'easeOut', delay: isCancelled ? 0 : 0.5 }}
      style={{ position: 'relative', zIndex: 2 }}
    >
      <rect
        x="-26" y="-11" width="52" height="22" rx="3"
        style={{ fill: 'hsl(var(--card))' }}
        stroke="currentColor" strokeWidth="1"
      />
      <line x1="-10" y1="-11" x2="-10" y2="11" stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" />
      <text x="2" y="2" textAnchor="middle" fontSize="6" fill="currentColor" fontWeight="700">
        {label}
      </text>
    </motion.svg>
  );
}
Ticket.propTypes = { variant: PropTypes.string.isRequired, label: PropTypes.string.isRequired };

function Box() {
  return (
    <motion.svg
      data-element="box"
      viewBox="-30 -20 60 40"
      width="140"
      height="90"
      className="text-primary"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'backOut', delay: 0.2 }}
      style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 1 }}
      aria-hidden="true"
    >
      {/* main body */}
      <rect x="-28" y="-2" width="56" height="20" rx="2" fill="currentColor" />
      {/* top highlight stripe */}
      <rect x="-28" y="-2" width="56" height="3" fill="currentColor" opacity="0.55" />
      {/* lid */}
      <motion.path
        d="M-30 -2 L-30 -10 L30 -10 L30 -2 Z"
        fill="currentColor"
        opacity="0.78"
        initial={{ rotate: 0 }}
        animate={{ rotate: -25 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        style={{ transformOrigin: '-30px -2px' }}
      />
    </motion.svg>
  );
}

function CelebrationArtwork({ variant, label }) {
  const reduced = useReducedMotion();
  const animated = !reduced && variant !== 'cancelled';
  return (
    <div
      data-element="artwork"
      style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}
    >
      {variant !== 'cancelled' && <Rays animated={animated} />}
      <Box />
      <Ticket variant={variant} label={label} />
    </div>
  );
}

CelebrationArtwork.propTypes = {
  variant: PropTypes.oneOf(['celebrate', 'win', 'cancelled']).isRequired,
  label: PropTypes.string.isRequired,
};

export default CelebrationArtwork;
