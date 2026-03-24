import { useTranslation } from "react-i18next";
import { useRafflePrizes } from "@/hooks/useRafflePrizes";
import { useSponsoredPrizes } from "@/hooks/useSponsoredPrizes";
import { useSponsorPrizeClaim } from "@/hooks/useSponsorPrize";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FaTrophy } from "react-icons/fa";
import { Gift } from "lucide-react";
import { formatEther } from "viem";
import PropTypes from "prop-types";
import ExplorerLink from "@/components/common/ExplorerLink";

function getTierName(index, t) {
  if (index === 0) return t("tierGrandPrize");
  if (index === 1) return t("tierRunnerUp");
  if (index === 2) return t("tierThirdPlace");
  return t("tierLabel", { number: index + 1 });
}

export function ClaimPrizeWidget({ seasonId }) {
  const { t } = useTranslation(["raffle", "common", "transactions"]);
  const {
    isWinner,
    claimableAmount,
    isLoading,
    isConfirming,
    isConfirmed,
    handleClaimGrandPrize,
    claimStatus,
    claimTxHash,
  } = useRafflePrizes(seasonId);

  const {
    winnerTier,
    sponsoredERC20,
    sponsoredERC721,
    tierConfigs,
    hasSponsoredPrizes,
  } = useSponsoredPrizes(seasonId);

  const { toast } = useToast();
  const {
    claimAll: claimSponsoredAll,
    isClaiming: isClaimingSponsored,
  } = useSponsorPrizeClaim(seasonId, {
    onSuccess: (type) => {
      const title = type === "erc20" ? t("raffle:sponsoredERC20Claimed") : t("raffle:sponsoredNFTClaimed");
      toast({ title, variant: "success" });
    },
    onError: (type, error) => {
      const desc = type === "erc20" ? t("raffle:claimERC20Failed") : t("raffle:claimNFTFailed");
      toast({ title: t("raffle:claimFailed"), description: error?.message || desc, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div>{t("common:loading")}</div>;
  }

  const isTierWinner = winnerTier?.isTierWinner;
  const tierIndex = winnerTier?.tierIndex ?? 0;

  // Show widget if user is grand winner OR a tier winner with sponsored prizes
  if (!isWinner && !isTierWinner) {
    return null;
  }

  // Calculate sponsored ERC-20 share for this tier
  const tierWinnerCount = tierConfigs[tierIndex]?.winnerCount || 1;
  const tierERC20 = sponsoredERC20.filter((p) => Number(p.targetTier) === tierIndex);
  const tierERC721 = sponsoredERC721.filter((p) => Number(p.targetTier) === tierIndex);

  const prizeType = t("raffle:grandPrize");

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center justify-center gap-2">
          <FaTrophy className="h-5 w-5 text-yellow-500" />
          <span>{t("raffle:congratulations")}</span>
          <FaTrophy className="h-5 w-5 text-yellow-500" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Tier badge */}
          {tierConfigs.length > 0 && (
            <div className="text-center">
              <Badge variant={tierIndex === 0 ? "default" : "secondary"}>
                {t("raffle:youWonTier", { tier: getTierName(tierIndex, t) })}
              </Badge>
            </div>
          )}

          {/* Grand Prize (SOF) — only for tier 0 / grand winner */}
          {isWinner && (
            <>
              <p className="text-lg text-center">
                {t("raffle:youWon")} {prizeType} — Season {String(seasonId)}
              </p>
              <div className="text-2xl font-bold text-center">
                {claimableAmount} SOF
              </div>
              <Button
                onClick={handleClaimGrandPrize}
                disabled={isConfirming || isConfirmed}
                className="w-full"
                variant={isConfirmed ? "outline" : "default"}
              >
                {isConfirming
                  ? t("transactions:claiming")
                  : isConfirmed
                  ? t("raffle:prizeClaimed")
                  : t("raffle:claimPrize")}
              </Button>
              {claimStatus === "completed" && claimTxHash && (
                <div className="text-center">
                  <ExplorerLink
                    value={claimTxHash}
                    type="tx"
                    text={t("raffle:viewTxOnExplorer")}
                    className="text-sm text-muted-foreground underline"
                  />
                </div>
              )}
            </>
          )}

          {/* Sponsored prizes for this tier */}
          {hasSponsoredPrizes && (tierERC20.length > 0 || tierERC721.length > 0) && (
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Gift className="h-4 w-4" />
                {t("raffle:claimSponsoredPrizes")}
              </div>

              {/* ERC-20 shares */}
              {tierERC20.map((prize, i) => {
                const share = BigInt(prize.amount) / BigInt(tierWinnerCount);
                return (
                  <div key={`erc20-${i}`} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {prize.token?.slice(0, 6)}...{prize.token?.slice(-4)}
                    </span>
                    <span className="font-mono">{formatEther(share)}</span>
                  </div>
                );
              })}

              {/* ERC-721 */}
              {tierERC721.map((prize, i) => (
                <div key={`erc721-${i}`} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    NFT {prize.token?.slice(0, 6)}...{prize.token?.slice(-4)}
                  </span>
                  <Badge variant="outline">#{String(prize.tokenId)}</Badge>
                </div>
              ))}

              <Button
                onClick={claimSponsoredAll}
                disabled={isClaimingSponsored}
                className="w-full"
                variant="secondary"
              >
                {isClaimingSponsored
                  ? t("transactions:claiming")
                  : t("raffle:claimSponsoredPrizes")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

ClaimPrizeWidget.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
};
