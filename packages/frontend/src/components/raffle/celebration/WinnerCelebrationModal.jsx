import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { formatUnits } from 'viem';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import UsernameDisplay from '@/components/user/UsernameDisplay';
import ClaimPrizeWidget from '@/components/prizes/ClaimPrizeWidget';
import CelebrationArtwork from './CelebrationArtwork';
import { fireWinBurst, reset as resetConfetti } from './confetti';

const AUTO_DISMISS_MS = {
  celebrate: 6000,
  win: 6000,
  cancelled: 4000,
};

function formatSofAmount(wei) {
  try {
    const human = formatUnits(BigInt(wei || 0n), 18);
    const n = Number(human);
    // Strip trailing decimal zeros; keep up to 2 decimal places.
    // Do NOT use toLocaleString — the i18n layer (react-i18next) handles
    // number formatting for display; we pass a plain numeric string to `t()`.
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, '');
  } catch {
    return '0';
  }
}

function WinnerCelebrationModal({
  variant,
  winnerAddress,
  grandPrizeWei,
  sponsoredPrizeLabel,
  seasonId,
  onDismiss,
}) {
  const { t } = useTranslation('raffle');
  const [open, setOpen] = useState(true);
  const dismissedRef = useRef(false);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setOpen(false);
  };

  // Fire onDismiss immediately on mount so the gate is recorded.
  useEffect(() => {
    onDismiss?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confetti on mount for celebrate/win.
  useEffect(() => {
    if (variant === 'celebrate' || variant === 'win') {
      fireWinBurst();
    }
    return () => resetConfetti();
  }, [variant]);

  // Auto-dismiss timer.
  useEffect(() => {
    const ms = AUTO_DISMISS_MS[variant] ?? 6000;
    const id = setTimeout(() => dismiss(), ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  if (!open) return null;

  const isCancelled = variant === 'cancelled';
  const isWin = variant === 'win';
  const sofText = isCancelled
    ? null
    : t('celebration.amountSof', { amount: formatSofAmount(grandPrizeWei) });

  return (
    <motion.div
      data-testid="celebration-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onClick={dismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
      className="bg-background/80"
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22, delay: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-xl p-6 max-w-sm w-[90%] text-center shadow-2xl"
        style={{ position: 'relative' }}
      >
        <CelebrationArtwork variant={variant} />

        <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
          {isCancelled
            ? t('celebration.cancelledHeadline')
            : isWin
              ? t('celebration.youWonHeadline')
              : t('celebration.winnerLabel')}
        </div>

        {!isCancelled && (
          <div className="mt-1 text-lg font-semibold text-foreground">
            <UsernameDisplay address={winnerAddress} className="text-lg" />
          </div>
        )}

        {!isCancelled && (
          <div className="mt-2 text-2xl font-bold text-primary">
            {sofText}
          </div>
        )}

        {sponsoredPrizeLabel && !isCancelled && (
          <div className="mt-1 text-sm text-muted-foreground">
            {t('celebration.sponsoredPrizeAddon', { prizeName: sponsoredPrizeLabel })}
          </div>
        )}

        {isWin && (
          <div className="mt-4">
            <div className="text-sm text-muted-foreground mb-2">
              {t('celebration.youWonSubheadline')}
            </div>
            <ClaimPrizeWidget seasonId={seasonId} />
          </div>
        )}

        {isCancelled && (
          <div className="mt-2 text-sm text-muted-foreground">
            {t('celebration.cancelledSubheadline')}
          </div>
        )}

        <div className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {t('celebration.continueHint')}
        </div>
      </motion.div>
    </motion.div>
  );
}

WinnerCelebrationModal.propTypes = {
  variant: PropTypes.oneOf(['celebrate', 'win', 'cancelled']).isRequired,
  winnerAddress: PropTypes.string,
  grandPrizeWei: PropTypes.any,
  sponsoredPrizeLabel: PropTypes.string,
  seasonId: PropTypes.any.isRequired,
  onDismiss: PropTypes.func,
};

export default WinnerCelebrationModal;
