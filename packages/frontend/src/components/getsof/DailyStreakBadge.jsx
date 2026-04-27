// src/components/getsof/DailyStreakBadge.jsx
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { useAirdropStreak } from '@/hooks/useAirdropStreak';

/**
 * DailyStreakBadge — informational counter of consecutive daily $SOF claims.
 *
 * No rewards attached; just lets users see they've maintained a streak so
 * the daily-drip card feels like progress rather than a chore. Hidden when
 * the streak is 0 (nothing to celebrate yet) or while the on-chain log
 * scan is still pending.
 */
const DailyStreakBadge = () => {
  const { t } = useTranslation('getsof');
  const { streak, isLoading } = useAirdropStreak();

  if (isLoading || streak <= 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
      <Flame className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{t('streakDays', { count: streak })}</span>
    </div>
  );
};

export default DailyStreakBadge;
