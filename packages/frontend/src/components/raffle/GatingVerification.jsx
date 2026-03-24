// src/components/raffle/GatingVerification.jsx
// User-facing component for verifying gating requirements

import { useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { useAccount } from 'wagmi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useSeasonGating, GateType } from '@/hooks/useSeasonGating';

/**
 * GatingVerification - Component for users to verify their gating requirements
 * @param {Object} props
 * @param {number|bigint} props.seasonId - The season ID
 * @param {Function} props.onVerified - Callback when user becomes verified
 */
const GatingVerification = ({ seasonId, onVerified }) => {
  const { t } = useTranslation('raffle');
  const { isConnected } = useAccount();

  const {
    isVerified,
    isLoadingVerified,
    gates,
    enabledGates,
    hasGates,
    verifyPassword,
    isVerifying,
    isVerifyConfirming,
    isVerifyConfirmed,
    verifyError,
    hasContract,
  } = useSeasonGating(seasonId);

  // Local state for password inputs
  const [passwords, setPasswords] = useState({});
  const [showPasswords, setShowPasswords] = useState({});
  const [localError, setLocalError] = useState(null);

  // Get password gates only
  const passwordGates = useMemo(() => {
    return enabledGates.filter(g => g.gateType === GateType.PASSWORD);
  }, [enabledGates]);

  // Handle password input change
  const handlePasswordChange = useCallback((index, value) => {
    setPasswords(prev => ({ ...prev, [index]: value }));
    setLocalError(null);
  }, []);

  // Toggle password visibility
  const togglePasswordVisibility = useCallback((index) => {
    setShowPasswords(prev => ({ ...prev, [index]: !prev[index] }));
  }, []);

  // Submit password for verification
  const handleVerify = useCallback(async (gateIndex) => {
    const password = passwords[gateIndex];
    if (!password || password.trim().length === 0) {
      setLocalError(t('passwordRequired') || 'Please enter the password');
      return;
    }

    try {
      setLocalError(null);
      await verifyPassword(gateIndex, password);
      // Clear password after successful verification
      setPasswords(prev => ({ ...prev, [gateIndex]: '' }));
    } catch (err) {
      setLocalError(err.message);
    }
  }, [passwords, verifyPassword, t]);

  // Notify parent when verified
  if (isVerifyConfirmed && onVerified) {
    onVerified();
  }

  // If no contract or not connected, show nothing or prompt
  if (!hasContract) {
    return null;
  }

  if (!isConnected) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          {t('connectWalletToVerify') || 'Connect your wallet to verify participation requirements.'}
        </AlertDescription>
      </Alert>
    );
  }

  // Loading state
  if (isLoadingVerified) {
    return (
      <div className="flex items-center gap-2 p-4 border rounded-lg bg-muted/20">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">
          {t('checkingVerification') || 'Checking verification status...'}
        </span>
      </div>
    );
  }

  // If no gates or already verified
  if (!hasGates || isVerified) {
    return (
      <div className="flex items-center gap-2 p-3 border rounded-lg bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <span className="text-sm text-green-700 dark:text-green-400">
          {hasGates
            ? t('verificationComplete') || 'You are verified to participate!'
            : t('noVerificationRequired') || 'No verification required for this season.'}
        </span>
      </div>
    );
  }

  // Show verification form
  return (
    <div className="space-y-4 p-4 border rounded-lg bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          <span className="font-medium text-amber-800 dark:text-amber-200">
            {t('verificationRequired') || 'Verification Required'}
          </span>
        </div>
        <Badge variant="outline" className="text-amber-600 border-amber-300">
          {passwordGates.length} {passwordGates.length === 1 ? 'password' : 'passwords'}
        </Badge>
      </div>

      <p className="text-sm text-amber-700 dark:text-amber-300">
        {t('verificationDesc') || 'Enter the password(s) to unlock participation in this season.'}
      </p>

      {/* Password inputs for each gate */}
      <div className="space-y-3">
        {passwordGates.map((gate, index) => {
          const originalIndex = gates.findIndex(g => g === gate);
          const password = passwords[originalIndex] || '';
          const showPassword = showPasswords[originalIndex] || false;

          return (
            <div key={originalIndex} className="space-y-2">
              <label className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('password') || 'Password'} {passwordGates.length > 1 ? `#${index + 1}` : ''}
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('enterPassword') || 'Enter password'}
                    value={password}
                    onChange={(e) => handlePasswordChange(originalIndex, e.target.value)}
                    className="pl-10 pr-10"
                    disabled={isVerifying || isVerifyConfirming}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => togglePasswordVisibility(originalIndex)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  onClick={() => handleVerify(originalIndex)}
                  disabled={isVerifying || isVerifyConfirming || !password}
                  className="min-w-[100px]"
                >
                  {isVerifying || isVerifyConfirming ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('verifying') || 'Verifying...'}
                    </>
                  ) : (
                    t('verify') || 'Verify'
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {(localError || verifyError) && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            {localError || verifyError?.message || t('verificationFailed') || 'Verification failed'}
          </AlertDescription>
        </Alert>
      )}

      {/* Success message */}
      {isVerifyConfirmed && (
        <Alert className="border-green-200 bg-green-50 dark:bg-green-950/30">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700 dark:text-green-400">
            {t('passwordVerified') || 'Password verified! Checking if all requirements are met...'}
          </AlertDescription>
        </Alert>
      )}

      {/* Help text */}
      <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
        {t('verificationHelpText') || 'All passwords must be verified to participate.'}
      </p>
    </div>
  );
};

GatingVerification.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  onVerified: PropTypes.func,
};

export default GatingVerification;
