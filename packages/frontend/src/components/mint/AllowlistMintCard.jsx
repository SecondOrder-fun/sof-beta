/**
 * AllowlistMintCard Component
 * Gated NFT minting for allowlisted users via Mint.Club SDK
 */

import { useState } from "react";
import PropTypes from "prop-types";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
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
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { useAllowlist } from "@/hooks/useAllowlist";
import { useMintClubNFT } from "@/hooks/useMintClubNFT";

/**
 * AllowlistMintCard - NFT minting card with allowlist gating
 * @param {object} props
 * @param {object} props.drop - NFT drop data from database
 * @param {boolean} props.showDebugInfo - Show debug information
 */
export function AllowlistMintCard({ drop = null, showDebugInfo = false }) {
  const { address, isConnected } = useAccount();
  const { isAllowlisted, isLoading: allowlistLoading } = useAllowlist();

  // Get symbol and network from drop or use defaults
  const nftSymbol = drop?.nft_symbol || null;
  const nftNetwork = drop?.network || "base";

  const {
    isLoading: nftLoading,
    error: nftError,
    isConfigured,
    symbol,
    network,
    exists,
    totalSupply,
    maxSupply,
    priceForNextMint,
    userBalance,
    reserveToken,
    mint,
    refetch,
  } = useMintClubNFT({ symbol: nftSymbol, network: nftNetwork });

  const [mintState, setMintState] = useState({
    status: "idle", // idle, signing, pending, success, error
    txHash: null,
    error: null,
  });

  const handleMint = async () => {
    setMintState({ status: "idle", txHash: null, error: null });

    try {
      await mint({
        amount: 1n,
        slippage: 10, // 1% slippage
        onSignatureRequest: () => {
          setMintState((prev) => ({ ...prev, status: "signing" }));
        },
        onSigned: (hash) => {
          setMintState((prev) => ({
            ...prev,
            status: "pending",
            txHash: hash,
          }));
        },
        onSuccess: () => {
          setMintState((prev) => ({ ...prev, status: "success" }));
        },
        onError: (err) => {
          setMintState((prev) => ({
            ...prev,
            status: "error",
            error: err.message,
          }));
        },
      });
    } catch (err) {
      setMintState({ status: "error", txHash: null, error: err.message });
    }
  };

  const formatPrice = (price) => {
    if (!price || !reserveToken) return "...";
    const formatted = formatUnits(price, reserveToken.decimals);
    return `${parseFloat(formatted).toFixed(6)} ${reserveToken.symbol}`;
  };

  const isSoldOut = maxSupply > 0n && totalSupply >= maxSupply;
  const isLoading = allowlistLoading || nftLoading;

  // Not configured
  if (!isConfigured) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            NFT Mint
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertDescription>
              NFT symbol not configured. Set{" "}
              <code>VITE_MINTCLUB_NFT_SYMBOL</code> in your environment.
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
            <Sparkles className="h-5 w-5" />
            NFT Mint
          </CardTitle>
          <CardDescription>
            Connect your wallet to check eligibility
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Connect your wallet to see if you&apos;re eligible to mint.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={isAllowlisted ? "border-green-500/50" : "border-red-500/30"}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            NFT Mint
          </CardTitle>
          {isAllowlisted ? (
            <Badge
              variant="success"
              className="bg-green-500/20 text-green-400 border-green-500/50"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              Allowlisted
            </Badge>
          ) : (
            <Badge
              variant="destructive"
              className="bg-red-500/20 text-red-400 border-red-500/50"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Not Allowlisted
            </Badge>
          )}
        </div>
        <CardDescription>
          {symbol} on {network}
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
        {nftError && !isLoading && (
          <Alert variant="destructive">
            <AlertDescription>{nftError}</AlertDescription>
          </Alert>
        )}

        {/* NFT doesn&apos;t exist */}
        {!exists && !isLoading && !nftError && (
          <Alert>
            <AlertDescription>
              NFT collection <strong>{symbol}</strong> does not exist on{" "}
              {network}.
            </AlertDescription>
          </Alert>
        )}

        {/* NFT Data */}
        {exists && !isLoading && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground">Supply</p>
                <p className="font-mono font-medium">
                  {totalSupply.toString()} /{" "}
                  {maxSupply > 0n ? maxSupply.toString() : "∞"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">Your Balance</p>
                <p className="font-mono font-medium">
                  {userBalance.toString()}
                </p>
              </div>
              <div className="col-span-2 space-y-1">
                <p className="text-muted-foreground">Price</p>
                <p className="font-mono font-medium text-lg">
                  {formatPrice(priceForNextMint)}
                </p>
              </div>
            </div>

            {/* Sold Out */}
            {isSoldOut && (
              <Alert>
                <AlertDescription>
                  This NFT collection is sold out.
                </AlertDescription>
              </Alert>
            )}

            {/* Not Allowlisted Message */}
            {!isAllowlisted && !isSoldOut && (
              <Alert variant="destructive">
                <AlertDescription>
                  Your wallet is not on the allowlist. Add the app to get
                  allowlisted.
                </AlertDescription>
              </Alert>
            )}

            {/* Mint Button */}
            {isAllowlisted && !isSoldOut && (
              <div className="space-y-3">
                <Button
                  onClick={handleMint}
                  disabled={
                    mintState.status === "signing" ||
                    mintState.status === "pending"
                  }
                  className="w-full"
                  size="lg"
                >
                  {mintState.status === "signing" && (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Waiting for signature...
                    </>
                  )}
                  {mintState.status === "pending" && (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Minting...
                    </>
                  )}
                  {(mintState.status === "idle" ||
                    mintState.status === "success" ||
                    mintState.status === "error") && (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Mint NFT
                    </>
                  )}
                </Button>

                {/* Success Message */}
                {mintState.status === "success" && (
                  <Alert className="bg-green-500/10 border-green-500/50">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <AlertDescription className="text-green-400">
                      NFT minted successfully!
                      {mintState.txHash && (
                        <a
                          href={`https://basescan.org/tx/${mintState.txHash}`}
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
                {mintState.status === "error" && mintState.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{mintState.error}</AlertDescription>
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
            <p>Symbol: {symbol}</p>
            <p>Network: {network}</p>
            <p>Configured: {isConfigured ? "Yes" : "No"}</p>
            <p>Exists: {exists ? "Yes" : "No"}</p>
            <p>Allowlisted: {isAllowlisted ? "Yes" : "No"}</p>
            <p>Address: {address}</p>
            <p>Reserve Token: {reserveToken?.symbol || "N/A"}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

AllowlistMintCard.propTypes = {
  drop: PropTypes.shape({
    id: PropTypes.number,
    name: PropTypes.string,
    nft_symbol: PropTypes.string,
    network: PropTypes.string,
    requires_allowlist: PropTypes.bool,
  }),
  showDebugInfo: PropTypes.bool,
};

export default AllowlistMintCard;
