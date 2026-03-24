/**
 * GiftClaimCard Component
 * Free NFT claim for whitelisted users via Mint.Club MerkleDistributor
 */

import { useState } from "react";
import PropTypes from "prop-types";
import { useAccount } from "wagmi";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Gift,
  ExternalLink,
  Clock,
} from "lucide-react";
import { useMintClubAirdrop } from "@/hooks/useMintClubAirdrop";

/**
 * GiftClaimCard - Free NFT claim card for whitelisted users
 * @param {object} props
 * @param {object} props.drop - NFT drop data from database
 * @param {boolean} props.showDebugInfo - Show debug information
 */
export function GiftClaimCard({ drop = null, showDebugInfo = false }) {
  const { address, isConnected } = useAccount();

  // Get airdrop ID and network from drop or use defaults
  const dropAirdropId = drop?.airdrop_id || null;
  const dropNetwork = drop?.network || "base";

  const {
    isLoading,
    error,
    isConfigured,
    airdropId,
    network,
    exists,
    title,
    walletCount,
    claimCount,
    amountPerClaim,
    startTime,
    endTime,
    isWhitelistOnly,
    userClaimed,
    userWhitelisted,
    isRefunded,
    isActive,
    canClaim,
    claimsRemaining,
    claim,
    refetch,
  } = useMintClubAirdrop({ airdropId: dropAirdropId, network: dropNetwork });

  const [claimState, setClaimState] = useState({
    status: "idle", // idle, signing, pending, success, error
    txHash: null,
    error: null,
  });

  const handleClaim = async () => {
    setClaimState({ status: "idle", txHash: null, error: null });

    try {
      await claim({
        onSignatureRequest: () => {
          setClaimState((prev) => ({ ...prev, status: "signing" }));
        },
        onSigned: (hash) => {
          setClaimState((prev) => ({
            ...prev,
            status: "pending",
            txHash: hash,
          }));
        },
        onSuccess: () => {
          setClaimState((prev) => ({ ...prev, status: "success" }));
        },
        onError: (err) => {
          setClaimState((prev) => ({
            ...prev,
            status: "error",
            error: err.message,
          }));
        },
      });
    } catch (err) {
      setClaimState({ status: "error", txHash: null, error: err.message });
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "N/A";
    return new Date(timestamp * 1000).toLocaleString();
  };

  // Not configured
  if (!isConfigured) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Free NFT Claim
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertDescription>
              Airdrop ID not configured. Set{" "}
              <code>VITE_MINTCLUB_AIRDROP_ID</code> in your environment.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Not connected
  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Free NFT Claim
          </CardTitle>
          <CardDescription>
            Connect your wallet to check eligibility
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Connect your wallet to see if you&apos;re eligible for a free NFT.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Determine eligibility status
  const getEligibilityBadge = () => {
    if (userClaimed) {
      return (
        <Badge
          variant="secondary"
          className="bg-blue-500/20 text-blue-400 border-blue-500/50"
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          Already Claimed
        </Badge>
      );
    }
    if (!isWhitelistOnly || userWhitelisted) {
      return (
        <Badge
          variant="success"
          className="bg-green-500/20 text-green-400 border-green-500/50"
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          Eligible
        </Badge>
      );
    }
    return (
      <Badge
        variant="destructive"
        className="bg-red-500/20 text-red-400 border-red-500/50"
      >
        <XCircle className="h-3 w-3 mr-1" />
        Not Eligible
      </Badge>
    );
  };

  return (
    <Card
      className={
        canClaim
          ? "border-green-500/50"
          : userClaimed
          ? "border-blue-500/30"
          : "border-muted"
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Free NFT Claim
          </CardTitle>
          {getEligibilityBadge()}
        </div>
        <CardDescription>
          {title || `Airdrop #${airdropId}`} on {network}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Airdrop doesn&apos;t exist */}
        {!exists && !isLoading && !error && (
          <Alert>
            <AlertDescription>
              Airdrop #{airdropId} does not exist on {network}.
            </AlertDescription>
          </Alert>
        )}

        {/* Refunded */}
        {isRefunded && (
          <Alert variant="destructive">
            <AlertDescription>
              This airdrop has been cancelled and refunded.
            </AlertDescription>
          </Alert>
        )}

        {/* Airdrop Data */}
        {exists && !isLoading && !isRefunded && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground">Claims</p>
                <p className="font-mono font-medium">
                  {claimCount} / {walletCount}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">Remaining</p>
                <p className="font-mono font-medium">{claimsRemaining}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">Amount per Claim</p>
                <p className="font-mono font-medium">
                  {amountPerClaim.toString()} NFT(s)
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium">
                  {isActive ? (
                    <span className="text-green-400">Active</span>
                  ) : (
                    <span className="text-yellow-400">Inactive</span>
                  )}
                </p>
              </div>
            </div>

            {/* Time Info */}
            {(startTime > 0 || endTime > 0) && (
              <div className="text-xs text-muted-foreground space-y-1 p-2 bg-muted/30 rounded">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>
                    {startTime > 0 && `Starts: ${formatDate(startTime)}`}
                    {startTime > 0 && endTime > 0 && " | "}
                    {endTime > 0 && `Ends: ${formatDate(endTime)}`}
                  </span>
                </div>
              </div>
            )}

            {/* Sold Out */}
            {claimsRemaining <= 0 && !userClaimed && (
              <Alert>
                <AlertDescription>All NFTs have been claimed.</AlertDescription>
              </Alert>
            )}

            {/* Not Active */}
            {!isActive && !userClaimed && claimsRemaining > 0 && (
              <Alert>
                <AlertDescription>
                  {startTime > 0 && Date.now() / 1000 < startTime
                    ? "This airdrop has not started yet."
                    : "This airdrop has ended."}
                </AlertDescription>
              </Alert>
            )}

            {/* Not Whitelisted */}
            {isWhitelistOnly && !userWhitelisted && !userClaimed && (
              <Alert variant="destructive">
                <AlertDescription>
                  Your wallet is not on the whitelist for this airdrop.
                </AlertDescription>
              </Alert>
            )}

            {/* Already Claimed */}
            {userClaimed && (
              <Alert className="bg-blue-500/10 border-blue-500/50">
                <CheckCircle className="h-4 w-4 text-blue-500" />
                <AlertDescription className="text-blue-400">
                  You have already claimed your free NFT!
                </AlertDescription>
              </Alert>
            )}

            {/* Claim Button */}
            {canClaim && (
              <div className="space-y-3">
                <Button
                  onClick={handleClaim}
                  disabled={
                    claimState.status === "signing" ||
                    claimState.status === "pending"
                  }
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500"
                  size="lg"
                >
                  {claimState.status === "signing" && (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Waiting for signature...
                    </>
                  )}
                  {claimState.status === "pending" && (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Claiming...
                    </>
                  )}
                  {(claimState.status === "idle" ||
                    claimState.status === "success" ||
                    claimState.status === "error") && (
                    <>
                      <Gift className="h-4 w-4 mr-2" />
                      Claim Free NFT
                    </>
                  )}
                </Button>

                {/* Success Message */}
                {claimState.status === "success" && (
                  <Alert className="bg-green-500/10 border-green-500/50">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <AlertDescription className="text-green-400">
                      NFT claimed successfully!
                      {claimState.txHash && (
                        <a
                          href={`https://basescan.org/tx/${claimState.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center text-green-300 hover:text-green-200"
                        >
                          View tx <ExternalLink className="h-3 w-3 ml-1" />
                        </a>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Error Message */}
                {claimState.status === "error" && claimState.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{claimState.error}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              className="w-full"
            >
              Refresh Data
            </Button>
          </>
        )}

        {/* Debug Info */}
        {showDebugInfo && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs font-mono space-y-1">
            <p>Airdrop ID: {airdropId}</p>
            <p>Network: {network}</p>
            <p>Configured: {isConfigured ? "Yes" : "No"}</p>
            <p>Exists: {exists ? "Yes" : "No"}</p>
            <p>Active: {isActive ? "Yes" : "No"}</p>
            <p>Whitelist Only: {isWhitelistOnly ? "Yes" : "No"}</p>
            <p>User Whitelisted: {userWhitelisted ? "Yes" : "No"}</p>
            <p>User Claimed: {userClaimed ? "Yes" : "No"}</p>
            <p>Can Claim: {canClaim ? "Yes" : "No"}</p>
            <p>Address: {address}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

GiftClaimCard.propTypes = {
  drop: PropTypes.shape({
    id: PropTypes.number,
    name: PropTypes.string,
    airdrop_id: PropTypes.number,
    network: PropTypes.string,
  }),
  showDebugInfo: PropTypes.bool,
};

export default GiftClaimCard;
