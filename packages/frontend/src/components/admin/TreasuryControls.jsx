import { useEffect, useMemo, useState } from "react";
import { useTreasury } from "@/hooks/useTreasury";
import { useCurveState } from "@/hooks/useCurveState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  CheckCircle2,
  Wallet,
  TrendingUp,
  Info,
} from "lucide-react";
import PropTypes from "prop-types";
import { useToast } from "@/hooks/useToast";

export function TreasuryControls({ seasonId, bondingCurveAddress }) {
  const {
    accumulatedFees,
    accumulatedFeesRaw,
    sofReserves,
    treasuryAddress,
    hasManagerRole,
    extractFees,
    isExtracting,
    isExtractConfirmed,
    extractError,
  } = useTreasury(seasonId, bondingCurveAddress);

  const { curveReserves, curveFees } = useCurveState(bondingCurveAddress, {
    isActive: true,
    pollMs: 12000,
  });

  const liveAccumulatedFees = useMemo(() => {
    if (curveFees && curveFees > 0n) {
      return Number(curveFees) / 1e18;
    }
    return parseFloat(accumulatedFees);
  }, [curveFees, accumulatedFees]);

  const liveReserves = useMemo(() => {
    if (curveReserves && curveReserves > 0n) {
      return Number(curveReserves) / 1e18;
    }
    return parseFloat(sofReserves);
  }, [curveReserves, sofReserves]);

  const pendingFeesRaw = accumulatedFeesRaw ?? 0n;
  const hasExtractPermission = Boolean(hasManagerRole);
  const canExtractNow = hasExtractPermission && pendingFeesRaw > 0n;

  const liveAccumulatedFeesFormatted = useMemo(
    () => liveAccumulatedFees.toFixed(4),
    [liveAccumulatedFees]
  );
  const liveReservesFormatted = useMemo(
    () => liveReserves.toFixed(4),
    [liveReserves]
  );
  const liveTotalCurveHoldingsFormatted = useMemo(
    () => (liveAccumulatedFees + liveReserves).toFixed(4),
    [liveAccumulatedFees, liveReserves]
  );

  const [lastExtractAmount, setLastExtractAmount] = useState(null);
  const { toast } = useToast();

  const handleExtract = async () => {
    setLastExtractAmount(liveAccumulatedFees);
    await extractFees();
  };

  useEffect(() => {
    if (isExtractConfirmed && lastExtractAmount !== null) {
      toast({
        title: "Fees extracted",
        description: `Sent ${lastExtractAmount.toFixed(2)} SOF to the treasury address.`,
      });
      setLastExtractAmount(null);
    }
  }, [isExtractConfirmed, lastExtractAmount, toast]);

  useEffect(() => {
    if (extractError) {
      toast({
        title: "Extraction failed",
        description: extractError?.shortMessage || extractError?.message || "Transaction reverted.",
        variant: "destructive",
      });
    }
  }, [extractError, toast]);

  if (!hasManagerRole) {
    return null;
  }

  return (
    <Card className="mt-4 border-warning" data-testid="treasury-controls">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Treasury Management
        </CardTitle>
        <CardDescription>
          Extract accumulated bonding-curve fees to the season&apos;s treasury address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fee Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Accumulated Fees
            </p>
            <p className="text-2xl font-bold">
              {liveAccumulatedFeesFormatted} SOF
            </p>
            <p className="text-xs text-muted-foreground">Pending extraction</p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              Curve Reserves
            </p>
            <p className="text-2xl font-bold">
              {liveReservesFormatted} SOF
            </p>
            <p className="text-xs text-muted-foreground">
              Backing outstanding tickets (not extractable)
            </p>
          </div>
        </div>

        <div className="border border-warning/20 bg-warning/10 rounded-md p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Info className="h-4 w-4" />
              Pending Treasury Fees
            </p>
            <p className="text-xl font-semibold text-warning">
              {liveAccumulatedFeesFormatted} SOF
            </p>
            <p className="text-xs text-muted-foreground">
              Waiting to be extracted from the bonding curve.
            </p>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Total SOF on curve:{" "}
              <span className="font-semibold">
                {liveTotalCurveHoldingsFormatted} SOF
              </span>
            </p>
            <p>
              Reserves backing tickets:{" "}
              <span className="font-semibold">{liveReservesFormatted} SOF</span>
            </p>
            <p>
              Fees awaiting extraction:{" "}
              <span className="font-semibold">
                {liveAccumulatedFeesFormatted} SOF
              </span>
            </p>
          </div>
        </div>

        <Separator />

        {/* Fee Extraction */}
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold mb-1">Extract Fees</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Sends accumulated fees from the bonding curve directly to the
              treasury address configured at curve deployment.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleExtract}
              disabled={!canExtractNow || isExtracting}
              variant="default"
              data-testid="extract-fees-button"
            >
              {isExtracting
                ? "Extracting..."
                : `Extract ${liveAccumulatedFees.toFixed(2)} SOF`}
            </Button>

            {isExtractConfirmed && (
              <Alert className="flex-1 py-2">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Fees extracted successfully!
                </AlertDescription>
              </Alert>
            )}
          </div>

          {!hasExtractPermission && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Wallet is missing RAFFLE_MANAGER_ROLE. Ask a factory admin to
                grant it before extracting fees.
              </AlertDescription>
            </Alert>
          )}

          {extractError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {extractError.message || "Failed to extract fees"}
              </AlertDescription>
            </Alert>
          )}

          {pendingFeesRaw === 0n && (
            <p className="text-sm text-muted-foreground">
              No fees to extract. Fees accumulate as users buy/sell tickets.
            </p>
          )}

          {treasuryAddress && (
            <div className="text-sm text-muted-foreground">
              <p className="font-medium">Treasury Address (read-only):</p>
              <p className="font-mono text-xs break-all">{treasuryAddress}</p>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium">How it works:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>
              Fees accumulate in the bonding curve as users trade (buy fee +
              sell fee, configured per season).
            </li>
            <li>
              An admin with RAFFLE_MANAGER_ROLE calls{" "}
              <code>extractFeesToTreasury()</code>, which transfers the pending
              balance straight to the curve&apos;s treasury address.
            </li>
          </ol>

          <p className="text-xs mt-3">
            <strong>Note:</strong> The treasury address is set at curve
            deployment and cannot be changed. For production, it should be a
            multisig.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

TreasuryControls.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
  bondingCurveAddress: PropTypes.string,
};
