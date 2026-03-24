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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  CheckCircle2,
  Wallet,
  TrendingUp,
  DollarSign,
  Info,
} from "lucide-react";
import PropTypes from "prop-types";
import { formatEther, parseEther } from "viem";
import { useToast } from "@/hooks/useToast";

export function TreasuryControls({ seasonId, bondingCurveAddress }) {
  const {
    accumulatedFees,
    accumulatedFeesRaw,
    sofReserves,
    treasuryBalance,
    treasuryBalanceRaw,
    totalFeesCollected,
    treasuryAddress,
    hasManagerRole,
    hasTreasuryRole,
    canTransferToTreasury,
    extractFees,
    transferToTreasury,
    updateTreasuryAddress,
    isExtracting,
    isExtractConfirmed,
    extractError,
    isTransferring,
    isTransferConfirmed,
    transferError,
    isUpdatingTreasury: hookIsUpdatingTreasury,
    isUpdateConfirmed: _isUpdateConfirmed,
    updateError: _updateError,
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

  const [transferAmount, setTransferAmount] = useState("");
  const [lastExtractAmount, setLastExtractAmount] = useState(null);
  const [lastTransferAmount, setLastTransferAmount] = useState(null);
  const [newTreasuryAddress, setNewTreasuryAddress] = useState("");
  const { toast } = useToast();

  const handleExtract = async () => {
    setLastExtractAmount(liveAccumulatedFees);
    await extractFees();
  };

  const handleTransfer = async () => {
    if (!transferAmount || parseFloat(transferAmount) <= 0) return;

    try {
      const amount = parseEther(transferAmount);
      setLastTransferAmount(parseFloat(transferAmount));
      await transferToTreasury(amount);
      setTransferAmount("");
    } catch (error) {
      // Error is handled by wagmi
      return;
    }
  };

  const handleTransferAll = async () => {
    if (!treasuryBalanceRaw) return;
    setLastTransferAmount(parseFloat(formatEther(treasuryBalanceRaw)));
    await transferToTreasury(treasuryBalanceRaw);
  };

  const handleUpdateTreasuryAddress = async () => {
    if (!newTreasuryAddress || !/^0x[a-fA-F0-9]{40}$/.test(newTreasuryAddress)) {
      toast({
        title: "Invalid address",
        description: "Please enter a valid Ethereum address",
        variant: "destructive",
      });
      return;
    }

    await updateTreasuryAddress(newTreasuryAddress);
    setNewTreasuryAddress("");
  };

  useEffect(() => {
    if (isExtractConfirmed && lastExtractAmount !== null) {
      toast({
        title: "Fees extracted",
        description: `Moved ${lastExtractAmount.toFixed(2)} SOF into the SOF token contract.`,
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

  useEffect(() => {
    if (isTransferConfirmed && lastTransferAmount !== null) {
      toast({
        title: "Fees sent to treasury",
        description: `Transferred ${lastTransferAmount.toFixed(2)} SOF to ${treasuryAddress}.`,
      });
      setLastTransferAmount(null);
    }
  }, [isTransferConfirmed, lastTransferAmount, toast, treasuryAddress]);

  useEffect(() => {
    if (transferError) {
      toast({
        title: "Treasury transfer failed",
        description: transferError?.shortMessage || transferError?.message || "Transaction reverted.",
        variant: "destructive",
      });
    }
  }, [transferError, toast]);

  if (!hasManagerRole && !hasTreasuryRole) {
    return null; // Don't show treasury controls if user doesn't have permissions
  }

  return (
    <Card className="mt-4 border-warning" data-testid="treasury-controls">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Treasury Management
        </CardTitle>
        <CardDescription>
          Manage platform fee collection and treasury distribution
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fee Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Accumulated Fees
            </p>
            <p className="text-2xl font-bold">
              {liveAccumulatedFeesFormatted} SOF
            </p>
            <p className="text-xs text-muted-foreground">In bonding curve</p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Treasury Balance
            </p>
            <p className="text-2xl font-bold">
              {parseFloat(treasuryBalance).toFixed(4)} SOF
            </p>
            <p className="text-xs text-muted-foreground">
              In SOF token contract
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              Total Collected
            </p>
            <p className="text-2xl font-bold">
              {parseFloat(totalFeesCollected).toFixed(4)} SOF
            </p>
            <p className="text-xs text-muted-foreground">
              All-time platform revenue
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

        {/* Fee Extraction Section */}
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold mb-1">Step 1: Extract Fees</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Transfer accumulated fees from bonding curve to SOF token
              contract
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
        </div>

        {hasManagerRole && hasTreasuryRole && <Separator />}

        {/* Treasury Distribution Section */}
        {hasTreasuryRole && (
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold mb-1">
                Step 2: Distribute to Treasury
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Transfer fees from SOF token contract to treasury address
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="transfer-amount">Amount (SOF)</Label>
                <div className="flex gap-2">
                  <Input
                    id="transfer-amount"
                    type="number"
                    placeholder="0.00"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    disabled={isTransferring}
                    step="0.01"
                    min="0"
                    max={treasuryBalance}
                  />
                  <Button
                    onClick={() => setTransferAmount(treasuryBalance)}
                    variant="outline"
                    disabled={isTransferring}
                  >
                    Max
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleTransfer}
                  disabled={
                    !canTransferToTreasury || !transferAmount || isTransferring
                  }
                  variant="default"
                  data-testid="transfer-to-treasury-button"
                >
                  {isTransferring ? "Transferring..." : "Transfer to Treasury"}
                </Button>

                <Button
                  onClick={handleTransferAll}
                  disabled={!canTransferToTreasury || isTransferring}
                  variant="outline"
                  data-testid="transfer-all-button"
                >
                  Transfer All
                </Button>
              </div>

              {isTransferConfirmed && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Transferred successfully to treasury!
                  </AlertDescription>
                </Alert>
              )}

              {transferError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {transferError.message || "Failed to transfer to treasury"}
                  </AlertDescription>
                </Alert>
              )}

              {treasuryAddress && (
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium">Treasury Address:</p>
                  <p className="font-mono text-xs break-all">
                    {treasuryAddress}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <Separator />

        {/* Treasury Address Management */}
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold mb-1">Update Treasury Address</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Change the address where extracted fees are sent
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="treasury-address">New Treasury Address</Label>
            <div className="flex gap-2">
              <Input
                id="treasury-address"
                type="text"
                placeholder="0x..."
                value={newTreasuryAddress}
                onChange={(e) => setNewTreasuryAddress(e.target.value)}
                disabled={hookIsUpdatingTreasury}
              />
              <Button
                onClick={handleUpdateTreasuryAddress}
                disabled={hookIsUpdatingTreasury || !newTreasuryAddress}
                variant="outline"
              >
                {hookIsUpdatingTreasury ? "Updating..." : "Update"}
              </Button>
            </div>
          </div>

          {treasuryAddress && (
            <div className="text-sm text-muted-foreground">
              <p className="font-medium">Current Treasury Address:</p>
              <p className="font-mono text-xs break-all">
                {treasuryAddress}
              </p>
            </div>
          )}
        </div>

        <Separator />

        {/* Additional Info */}
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium">How it works:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>
              Fees accumulate in bonding curve as users trade (0.1% buy, 0.7%
              sell)
            </li>
            <li>Admin extracts fees to SOF token contract (Step 1)</li>
            <li>
              Treasury manager distributes fees to treasury address (Step 2)
            </li>
          </ol>

          <p className="text-xs mt-3">
            <strong>Note:</strong> For production, treasury address should be a
            multisig wallet.
          </p>
        </div>

        {/* Reserves Info */}
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-sm font-medium mb-1">Bonding Curve Reserves</p>
          <p className="text-lg font-bold">{liveReservesFormatted} SOF</p>
          <p className="text-xs text-muted-foreground">
            Reserves backing raffle tokens (not extractable)
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
