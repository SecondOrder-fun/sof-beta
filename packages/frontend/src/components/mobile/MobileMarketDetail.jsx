// src/components/mobile/MobileMarketDetail.jsx
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import OddsChart from "@/components/infofi/OddsChart";
import BettingInterface from "@/components/infofi/BettingInterface";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import { placeBetTx } from "@/services/onchainInfoFi";

/**
 * MobileMarketDetail - Full market detail view for mobile.
 * Displays market info + compact OddsChart + BettingInterface.
 */
const MobileMarketDetail = ({ market, marketId }) => {
  const navigate = useNavigate();
  const { t } = useTranslation("market");
  const { isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [cardHeight, setCardHeight] = useState(null);
  const cardRef = useRef(null);

  const isWinnerPrediction =
    market.market_type === "WINNER_PREDICTION" && market.player;
  const seasonId = market.raffle_id ?? market.seasonId ?? market.season_id;

  // Adaptive card height
  useEffect(() => {
    const update = () => {
      if (!cardRef.current) return;
      const cardTop = cardRef.current.getBoundingClientRect().top;
      const navEl = document.querySelector("nav.fixed.bottom-0");
      const navHeight = navEl ? navEl.getBoundingClientRect().height : 120;
      const h = window.innerHeight - cardTop - navHeight - 12;
      setCardHeight(h);
    };
    const timer = setTimeout(update, 100);
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Place bet mutation
  const placeBetMutation = useMutation({
    mutationFn: async ({ side, amount }) => {
      return placeBetTx({
        prediction: side === "YES",
        amount,
        fpmmAddress: market.contract_address,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["infofiMarket", marketId] });
      queryClient.invalidateQueries({
        queryKey: ["oddsHistory", marketId],
      });
    },
  });

  const handleBet = ({ side, amount }) => {
    placeBetMutation.mutate({ side, amount });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      {/* Back button - UI library Button */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => navigate("/markets")}
        className="mb-3"
        aria-label={t("backToMarkets")}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      {/* Detail Card */}
      <Card
        ref={cardRef}
        className="flex flex-col overflow-hidden"
        style={cardHeight ? { height: cardHeight } : undefined}
      >
        <CardContent className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Question + status dot */}
          <div className="flex items-start gap-2">
            <h2 className="text-lg font-bold text-foreground leading-tight flex-1">
              {isWinnerPrediction ? (
                <span>
                  Will{" "}
                  <UsernameDisplay
                    address={market.player}
                    className="font-bold"
                  />{" "}
                  win Season {seasonId}?
                </span>
              ) : (
                market.question || market.market_type || "Market"
              )}
            </h2>
            {market.is_active && (
              <span className="shrink-0 mt-1 w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            )}
          </div>

          {/* Volume */}
          {market.volume != null && (
            <p className="text-sm text-muted-foreground text-center">
              ${Number(market.volume).toLocaleString()} volume
            </p>
          )}

          {/* Compact Odds Chart (with tabs/legend) */}
          <OddsChart marketId={marketId} compact />

          <Separator />

          {/* Betting Interface (question hidden, shown above) */}
          <BettingInterface
            market={market}
            onBet={handleBet}
            isConnected={isConnected}
            isLoading={placeBetMutation.isPending}
            showQuestion={false}
          />
        </CardContent>
      </Card>
    </div>
  );
};

MobileMarketDetail.propTypes = {
  market: PropTypes.object.isRequired,
  marketId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
};

export default MobileMarketDetail;
