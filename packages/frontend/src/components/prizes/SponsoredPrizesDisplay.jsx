import { useTranslation } from "react-i18next";
import { useSponsoredPrizes } from "@/hooks/useSponsoredPrizes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift } from "lucide-react";
import { formatEther } from "viem";
import PropTypes from "prop-types";

function getTierName(index, t) {
  if (index === 0) return t("tierGrandPrize");
  if (index === 1) return t("tierRunnerUp");
  if (index === 2) return t("tierThirdPlace");
  return t("tierLabel", { number: index + 1 });
}

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function SponsoredPrizesDisplay({ seasonId, isCompleted = false }) {
  const { t } = useTranslation("raffle");
  const {
    tierConfigs,
    sponsoredERC20,
    sponsoredERC721,
    tierWinners,
    hasSponsoredPrizes,
    isLoading,
  } = useSponsoredPrizes(seasonId);

  if (isLoading) return null;
  if (!hasSponsoredPrizes && tierConfigs.length === 0) return null;

  // Group ERC-20 prizes by tier
  const erc20ByTier = {};
  sponsoredERC20.forEach((prize) => {
    const tier = Number(prize.targetTier);
    if (!erc20ByTier[tier]) erc20ByTier[tier] = [];
    erc20ByTier[tier].push(prize);
  });

  // Group ERC-721 prizes by tier
  const erc721ByTier = {};
  sponsoredERC721.forEach((prize) => {
    const tier = Number(prize.targetTier);
    if (!erc721ByTier[tier]) erc721ByTier[tier] = [];
    erc721ByTier[tier].push(prize);
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4" />
          {t("sponsoredPrizes")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tier breakdown */}
        {tierConfigs.length > 0 && tierConfigs.map((tier, index) => {
          const winnerCount = Number(tier.winnerCount);
          const tierERC20 = erc20ByTier[index] || [];
          const tierERC721 = erc721ByTier[index] || [];
          const winners = tierWinners[index] || [];

          return (
            <div key={index} className="p-3 border border-border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={index === 0 ? "default" : "secondary"}>
                    {getTierName(index, t)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("tierWinnersDisplay", { count: winnerCount })}
                  </span>
                </div>
              </div>

              {/* ERC-20 prizes at this tier */}
              {tierERC20.length > 0 && (
                <div className="space-y-1">
                  {tierERC20.map((prize, i) => (
                    <div key={`erc20-${index}-${i}`} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {truncateAddress(prize.token)}
                      </span>
                      <span className="font-mono">
                        {formatEther(prize.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ERC-721 prizes at this tier */}
              {tierERC721.length > 0 && (
                <div className="space-y-1">
                  {tierERC721.map((prize, i) => (
                    <div key={`erc721-${index}-${i}`} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        NFT {truncateAddress(prize.token)}
                      </span>
                      <Badge variant="outline">#{String(prize.tokenId)}</Badge>
                    </div>
                  ))}
                </div>
              )}

              {tierERC20.length === 0 && tierERC721.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("noSponsoredPrizes")}</p>
              )}

              {/* Show winners if completed */}
              {isCompleted && winners.length > 0 && (
                <div className="pt-1 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-1">{t("winners")}:</p>
                  {winners.map((w, wi) => (
                    <span key={wi} className="text-xs font-mono text-muted-foreground">
                      {truncateAddress(w)}{wi < winners.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* If no tiers but prizes exist (legacy), show flat list */}
        {tierConfigs.length === 0 && hasSponsoredPrizes && (
          <div className="space-y-2">
            {sponsoredERC20.map((prize, i) => (
              <div key={`flat-erc20-${i}`} className="flex items-center justify-between text-sm p-2 border border-border rounded">
                <span className="text-muted-foreground">{truncateAddress(prize.token)}</span>
                <span className="font-mono">{formatEther(prize.amount)}</span>
              </div>
            ))}
            {sponsoredERC721.map((prize, i) => (
              <div key={`flat-erc721-${i}`} className="flex items-center justify-between text-sm p-2 border border-border rounded">
                <span className="text-muted-foreground">NFT {truncateAddress(prize.token)}</span>
                <Badge variant="outline">#{String(prize.tokenId)}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

SponsoredPrizesDisplay.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  isCompleted: PropTypes.bool,
};
