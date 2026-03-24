// src/components/admin/AllowlistManager.jsx
// Admin component for batch-signing EIP-712 allowlist entries and uploading to backend

import { useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { isAddress } from 'viem';
import { useWalletClient } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  AlertTriangle,
  Loader2,
  Users,
  FileSignature,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const MAX_ADDRESSES = 200;
const WARN_THRESHOLD = 100;

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/**
 * AllowlistManager - Batch-sign EIP-712 allowlist entries and upload to backend
 */
const AllowlistManager = ({
  seasonId,
  gatingAddress,
  chainId,
  gateIndex = 0,
  seasonEndTime,
}) => {
  const { t } = useTranslation('admin');
  const { data: walletClient } = useWalletClient();

  const [addressInput, setAddressInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | signing | uploading | success | error
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  // Parse and deduplicate addresses from textarea
  const parsedAddresses = useMemo(() => {
    if (!addressInput.trim()) return [];
    const raw = addressInput
      .split(/[\s,]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    // Deduplicate (case-insensitive)
    const seen = new Set();
    return raw.filter((addr) => {
      const lower = addr.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  }, [addressInput]);

  // Validate each address
  const invalidAddresses = useMemo(
    () => parsedAddresses.filter((a) => !isAddress(a)),
    [parsedAddresses],
  );

  const validAddresses = useMemo(
    () => parsedAddresses.filter((a) => isAddress(a)),
    [parsedAddresses],
  );

  const addressCount = parsedAddresses.length;
  const isOverLimit = addressCount > MAX_ADDRESSES;
  const isWarning = addressCount > WARN_THRESHOLD && !isOverLimit;

  const canSign =
    validAddresses.length > 0 &&
    invalidAddresses.length === 0 &&
    !isOverLimit &&
    walletClient &&
    status === 'idle';

  // Compute deadline: seasonEndTime or 7 days from now
  const getDeadline = useCallback(() => {
    if (seasonEndTime) return BigInt(seasonEndTime);
    return BigInt(Math.floor(Date.now() / 1000) + SEVEN_DAYS_SECONDS);
  }, [seasonEndTime]);

  const handleSign = useCallback(async () => {
    if (!canSign) return;

    setStatus('signing');
    setErrorMsg('');
    const total = validAddresses.length;
    setProgress({ current: 0, total });

    const deadline = getDeadline();
    const signatures = [];

    const domain = {
      name: 'SecondOrder.fun SeasonGating',
      version: '1',
      chainId,
      verifyingContract: gatingAddress,
    };

    const types = {
      SeasonAllowlist: [
        { name: 'seasonId', type: 'uint256' },
        { name: 'gateIndex', type: 'uint256' },
        { name: 'participant', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    try {
      for (let i = 0; i < validAddresses.length; i++) {
        setProgress({ current: i + 1, total });

        const message = {
          seasonId: BigInt(seasonId),
          gateIndex: BigInt(gateIndex),
          participant: validAddresses[i],
          deadline,
        };

        const signature = await walletClient.signTypedData({
          domain,
          types,
          primaryType: 'SeasonAllowlist',
          message,
        });

        signatures.push({
          participant: validAddresses[i],
          deadline: deadline.toString(),
          gateIndex,
          signature,
        });
      }

      // Upload to backend
      setStatus('uploading');
      const res = await fetch(
        `${API_BASE}/gating/signatures/${seasonId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatures }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.message || `Upload failed with status ${res.status}`,
        );
      }

      setStatus('success');
    } catch (err) {
      setStatus('error');
      if (
        err?.message?.includes('User rejected') ||
        err?.message?.includes('User denied')
      ) {
        setErrorMsg(
          t('allowlistSignRejected', {
            defaultValue: 'Signing was rejected.',
          }),
        );
      } else {
        setErrorMsg(
          err?.message ||
            t('allowlistSignError', {
              defaultValue: 'An error occurred during signing.',
            }),
        );
      }
    }
  }, [
    canSign,
    validAddresses,
    getDeadline,
    chainId,
    gatingAddress,
    seasonId,
    gateIndex,
    walletClient,
    t,
  ]);

  const handleReset = useCallback(() => {
    setStatus('idle');
    setProgress({ current: 0, total: 0 });
    setErrorMsg('');
    setAddressInput('');
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <Label className="text-sm font-medium">
            {t('allowlistManager', {
              defaultValue: 'Allowlist Manager',
            })}
          </Label>
        </div>
        {addressCount > 0 && (
          <Badge
            variant={
              isOverLimit
                ? 'destructive'
                : isWarning
                  ? 'secondary'
                  : 'default'
            }
            className="text-xs"
          >
            {addressCount} {addressCount === 1 ? 'address' : 'addresses'}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('allowlistDesc', {
          defaultValue:
            'Paste wallet addresses to sign EIP-712 allowlist entries. Comma or newline separated.',
        })}
      </p>

      {status === 'success' ? (
        <div className="flex flex-col items-center gap-3 py-8 border rounded-lg bg-muted/20">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <p className="text-lg font-semibold">
            {t('allowlistSuccess', {
              defaultValue: 'Allowlist signatures uploaded successfully!',
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('allowlistSuccessCount', {
              defaultValue: '{{count}} entries signed and uploaded.',
              count: progress.total,
            })}
          </p>
          <Button variant="outline" size="sm" onClick={handleReset}>
            {t('allowlistSignMore', {
              defaultValue: 'Sign More',
            })}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          {/* Address textarea */}
          <div>
            <Label
              htmlFor="allowlist-addresses"
              className="text-sm font-medium mb-2 block text-muted-foreground"
            >
              {t('allowlistAddresses', {
                defaultValue: 'Wallet Addresses',
              })}
            </Label>
            <Textarea
              id="allowlist-addresses"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder={t('allowlistPlaceholder', {
                defaultValue:
                  '0x1234...abcd\n0x5678...efgh\nor comma-separated',
              })}
              disabled={status === 'signing' || status === 'uploading'}
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          {/* Warnings */}
          {isOverLimit && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('allowlistOverLimit', {
                defaultValue:
                  'Maximum {{max}} addresses allowed. Please reduce the list.',
                max: MAX_ADDRESSES,
              })}
            </p>
          )}

          {isWarning && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('allowlistWarning', {
                defaultValue:
                  'Large batch ({{count}} addresses). Signing may take a while.',
                count: addressCount,
              })}
            </p>
          )}

          {/* Invalid addresses */}
          {invalidAddresses.length > 0 && (
            <p className="text-xs text-destructive">
              {t('allowlistInvalid', {
                defaultValue:
                  '{{count}} invalid address(es): {{addresses}}',
                count: invalidAddresses.length,
                addresses: invalidAddresses.slice(0, 3).join(', ') +
                  (invalidAddresses.length > 3 ? '...' : ''),
              })}
            </p>
          )}

          {/* Error message */}
          {status === 'error' && errorMsg && (
            <p className="text-sm text-destructive">{errorMsg}</p>
          )}

          {/* Sign button */}
          <Button
            type="button"
            className="w-full"
            disabled={!canSign}
            onClick={handleSign}
          >
            {status === 'signing' ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('allowlistSigning', {
                  defaultValue: 'Signing {{current}} of {{total}}...',
                  current: progress.current,
                  total: progress.total,
                })}
              </span>
            ) : status === 'uploading' ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('allowlistUploading', {
                  defaultValue: 'Uploading signatures...',
                })}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <FileSignature className="w-4 h-4" />
                {t('allowlistSignButton', {
                  defaultValue: 'Sign Allowlist',
                })}
              </span>
            )}
          </Button>

          {/* Help text */}
          <p className="text-xs text-muted-foreground">
            {t('allowlistHelp', {
              defaultValue:
                'Each address will require a wallet signature confirmation. The sponsor signs once per address.',
            })}
          </p>
        </div>
      )}
    </div>
  );
};

AllowlistManager.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  gatingAddress: PropTypes.string.isRequired,
  chainId: PropTypes.number.isRequired,
  gateIndex: PropTypes.number,
  seasonEndTime: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default AllowlistManager;
