// src/components/getsof/AirdropClaimCard.jsx
import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAirdrop } from '@/hooks/useAirdrop';
import { useAppIdentity } from '@/hooks/useAppIdentity';
import { useToast } from '@/hooks/useToast';
import DailyStreakBadge from './DailyStreakBadge';

/**
 * AirdropClaimCard — primary claim surface on the Get SOF page.
 *
 * Three states:
 *   1. never-claimed → big CTA to claim the initial allocation (Farcaster
 *      verified path if the user has a fid; otherwise the basic flow).
 *   2. claimed + ready → daily-drip CTA with streak badge.
 *   3. claimed + on cooldown → muted card with countdown + streak badge.
 *
 * The dismissable banner pattern from the old /swap page is gone; this is
 * the canonical destination for claim flows now, so it should always show.
 */
const AirdropClaimCard = () => {
  const { t } = useTranslation('getsof');
  const { isConnected } = useAccount();
  const { fid } = useAppIdentity();

  const {
    hasClaimed,
    initialAmount,
    basicAmount,
    dailyAmount,
    canClaimDaily,
    timeUntilClaim,
    claimInitial,
    claimInitialBasic,
    claimInitialState,
    resetInitialState,
    claimDaily,
    claimDailyState,
    resetDailyState,
  } = useAirdrop();

  const { toast } = useToast();
  // Refs prevent unstable toast/t identities from triggering effect re-runs.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  // Surface initial-claim outcomes via toast; the card itself shows pending
  useEffect(() => {
    if (claimInitialState.isError && claimInitialState.error) {
      toastRef.current({
        title: tRef.current('claimError'),
        description: claimInitialState.error,
        variant: 'destructive',
      });
      resetInitialState();
    }
  }, [claimInitialState.isError, claimInitialState.error, resetInitialState]);

  useEffect(() => {
    if (claimInitialState.isSuccess) {
      toastRef.current({ title: tRef.current('claimedToast') });
    }
  }, [claimInitialState.isSuccess]);

  useEffect(() => {
    if (claimDailyState.isError && claimDailyState.error) {
      toastRef.current({
        title: tRef.current('claimError'),
        description: claimDailyState.error,
        variant: 'destructive',
      });
      resetDailyState();
    }
  }, [claimDailyState.isError, claimDailyState.error, resetDailyState]);

  useEffect(() => {
    if (claimDailyState.isSuccess) {
      toastRef.current({ title: tRef.current('claimedToast') });
      const timer = setTimeout(() => resetDailyState(), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [claimDailyState.isSuccess, resetDailyState]);

  // Wallet not connected — nudge them to connect; don't render the full card
  // shell since most actions are gated.
  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('claimCardTitle')}</CardTitle>
          <CardDescription>{t('connectWalletToClaim')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasFarcaster = Boolean(fid);
  const hasBasicClaim = basicAmount > 0;
  const initialPending = claimInitialState.isPending;
  const dailyPending = claimDailyState.isPending;

  // ── State 1: never-claimed ──────────────────────────────────────
  if (!hasClaimed) {
    const formattedAmount = (hasFarcaster
      ? initialAmount
      : hasBasicClaim
        ? basicAmount
        : initialAmount
    ).toLocaleString();

    const handleClaim = () => {
      if (hasFarcaster) {
        claimInitial(fid);
      } else if (hasBasicClaim) {
        claimInitialBasic();
      }
    };

    return (
      <Card className="border-primary">
        <CardHeader>
          <CardTitle>{t('initialClaimTitle')}</CardTitle>
          <CardDescription>{t('initialClaimDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {hasFarcaster ? (
            <Button
              onClick={handleClaim}
              disabled={initialPending}
              variant="farcaster"
              className="w-full"
            >
              {initialPending
                ? t('claiming')
                : t('claimInitial', { amount: formattedAmount })}
            </Button>
          ) : hasBasicClaim ? (
            <Button
              onClick={handleClaim}
              disabled={initialPending}
              variant="primary"
              className="w-full"
            >
              {initialPending
                ? t('claiming')
                : t('claimBasic', { amount: formattedAmount })}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('connectFarcaster')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── State 2 & 3: claimed (daily drip) ───────────────────────────
  const formattedDaily = dailyAmount.toLocaleString();

  if (canClaimDaily) {
    return (
      <Card className="border-primary">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>{t('dailyClaimTitle')}</CardTitle>
              <CardDescription>{t('dailyClaimDescription')}</CardDescription>
            </div>
            <DailyStreakBadge />
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => claimDaily()}
            disabled={dailyPending || claimDailyState.isSuccess}
            variant="primary"
            className="w-full"
          >
            {dailyPending
              ? t('claiming')
              : claimDailyState.isSuccess
                ? t('claimed')
                : t('claimDaily', { amount: formattedDaily })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // State 3 — on cooldown
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{t('dailyClaimTitle')}</CardTitle>
            <CardDescription>{t('dailyCooldownDescription')}</CardDescription>
          </div>
          <DailyStreakBadge />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('nextClaimIn')}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {timeUntilClaim || '—'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default AirdropClaimCard;
