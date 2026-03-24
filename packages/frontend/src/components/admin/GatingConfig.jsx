// src/components/admin/GatingConfig.jsx
// Admin component for configuring season gating requirements

import { useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { pad } from 'viem';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Lock, Eye, EyeOff, Trash2, Plus, ShieldCheck, Pen } from 'lucide-react';
import { hashPassword, GateType } from '@/hooks/useSeasonGating';

/**
 * GatingConfig - Component for configuring season participation requirements
 * @param {Object} props
 * @param {boolean} props.gated - Whether gating is enabled
 * @param {Function} props.onGatedChange - Callback when gated toggle changes
 * @param {Function} props.onGatesChange - Callback when gates configuration changes
 */
const GatingConfig = ({ gated, onGatedChange, onGatesChange }) => {
  const { t } = useTranslation('admin');

  // Local state for gates (supports PASSWORD and SIGNATURE types)
  const [gates, setGates] = useState([
    { gateType: GateType.PASSWORD, password: '', signerAddress: '', enabled: true, showPassword: false }
  ]);

  // Helper: check if a gate has valid input based on its type
  const isGateConfigured = useCallback((g) => {
    if (g.gateType === GateType.PASSWORD) {
      return g.password.trim().length > 0;
    }
    if (g.gateType === GateType.SIGNATURE) {
      return /^0x[0-9a-fA-F]{40}$/.test(g.signerAddress.trim());
    }
    return false;
  }, []);

  // Update parent when gates change
  const updateParent = useCallback((updatedGates) => {
    if (onGatesChange) {
      // Convert to contract format
      const formattedGates = updatedGates
        .filter(g => g.enabled && isGateConfigured(g))
        .map(g => {
          if (g.gateType === GateType.SIGNATURE) {
            return {
              gateType: GateType.SIGNATURE,
              enabled: true,
              configHash: pad(g.signerAddress.trim(), { size: 32 }),
            };
          }
          return {
            gateType: GateType.PASSWORD,
            enabled: true,
            configHash: hashPassword(g.password),
          };
        });
      onGatesChange(formattedGates);
    }
  }, [onGatesChange, isGateConfigured]);

  // Handle gate type change
  const handleGateTypeChange = useCallback((index, newType) => {
    setGates(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], gateType: Number(newType) };
      updateParent(updated);
      return updated;
    });
  }, [updateParent]);

  // Handle password change
  const handlePasswordChange = useCallback((index, value) => {
    setGates(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], password: value };
      updateParent(updated);
      return updated;
    });
  }, [updateParent]);

  // Handle signer address change
  const handleSignerAddressChange = useCallback((index, value) => {
    setGates(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], signerAddress: value };
      updateParent(updated);
      return updated;
    });
  }, [updateParent]);

  // Handle enabled toggle
  const handleEnabledChange = useCallback((index, enabled) => {
    setGates(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enabled };
      updateParent(updated);
      return updated;
    });
  }, [updateParent]);

  // Toggle password visibility
  const togglePasswordVisibility = useCallback((index) => {
    setGates(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], showPassword: !updated[index].showPassword };
      return updated;
    });
  }, []);

  // Add new gate
  const addGate = useCallback(() => {
    setGates(prev => [...prev, { gateType: GateType.PASSWORD, password: '', signerAddress: '', enabled: true, showPassword: false }]);
  }, []);

  // Remove gate
  const removeGate = useCallback((index) => {
    setGates(prev => {
      if (prev.length <= 1) return prev; // Keep at least one
      const updated = prev.filter((_, i) => i !== index);
      updateParent(updated);
      return updated;
    });
  }, [updateParent]);

  // Check if configuration is valid
  const isValid = useMemo(() => {
    if (!gated) return true;
    return gates.some(g => isGateConfigured(g) && g.enabled);
  }, [gated, gates, isGateConfigured]);

  // Count of configured gates
  const configuredCount = useMemo(() => {
    return gates.filter(g => isGateConfigured(g) && g.enabled).length;
  }, [gates, isGateConfigured]);

  return (
    <div className="space-y-4">
      {/* Gating Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <Label htmlFor="gating-toggle" className="text-sm font-medium">
            {t('participationRequirements')}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          {gated && configuredCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {configuredCount} {configuredCount === 1 ? 'gate' : 'gates'}
            </Badge>
          )}
          <Switch
            id="gating-toggle"
            checked={gated}
            onCheckedChange={onGatedChange}
          />
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">
        {gated
          ? t('gatingEnabledDesc')
          : t('gatingDisabledDesc')}
      </p>

      {/* Gates Configuration */}
      {gated && (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t('gatesConfiguration')}
            </Label>
            <Badge variant={isValid ? 'default' : 'destructive'} className="text-xs">
              {isValid ? t('valid') : t('invalid')}
            </Badge>
          </div>

          {/* Gate List */}
          <div className="space-y-3">
            {gates.map((gate, index) => (
              <div key={index} className="space-y-2 border rounded-md p-3 bg-background">
                {/* Gate type selector row */}
                <div className="flex items-center gap-2">
                  <Select
                    value={String(gate.gateType)}
                    onValueChange={(value) => handleGateTypeChange(index, value)}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(GateType.PASSWORD)}>
                        <span className="flex items-center gap-1.5">
                          <Lock className="h-3.5 w-3.5" />
                          {t('gateTypePassword')}
                        </span>
                      </SelectItem>
                      <SelectItem value={String(GateType.SIGNATURE)}>
                        <span className="flex items-center gap-1.5">
                          <Pen className="h-3.5 w-3.5" />
                          {t('gateTypeSignature')}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="flex-1" />

                  <Switch
                    checked={gate.enabled}
                    onCheckedChange={(checked) => handleEnabledChange(index, checked)}
                    title={gate.enabled ? t('enabled') : t('disabled')}
                  />

                  {gates.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeGate(index)}
                      className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Gate-specific input */}
                {gate.gateType === GateType.PASSWORD && (
                  <div className="relative">
                    <Input
                      type={gate.showPassword ? 'text' : 'password'}
                      placeholder={`${t('password')} ${index + 1}`}
                      value={gate.password}
                      onChange={(e) => handlePasswordChange(index, e.target.value)}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => togglePasswordVisibility(index)}
                    >
                      {gate.showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                )}

                {gate.gateType === GateType.SIGNATURE && (
                  <Input
                    type="text"
                    placeholder={t('signerAddressPlaceholder')}
                    value={gate.signerAddress}
                    onChange={(e) => handleSignerAddressChange(index, e.target.value)}
                    className="font-mono text-xs"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Add Gate Button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addGate}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('addGate')}
          </Button>

          {/* Help Text */}
          <p className="text-xs text-muted-foreground">
            {t('gatingHelpText')}
          </p>

          {/* Validation Warning */}
          {gated && !isValid && (
            <p className="text-xs text-destructive">
              {t('gatingValidationError')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

GatingConfig.propTypes = {
  gated: PropTypes.bool.isRequired,
  onGatedChange: PropTypes.func.isRequired,
  onGatesChange: PropTypes.func,
};

export default GatingConfig;
