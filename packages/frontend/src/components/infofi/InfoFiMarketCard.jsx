// src/components/infofi/InfoFiMarketCard.jsx
import React from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/useToast";
import { useAccount } from "wagmi";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buildPlaceBetCalls } from "@/services/onchainInfoFi";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { buildMarketTitleParts } from "@/lib/marketTitle";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import { useRaffleRead } from "@/hooks/useRaffleRead";
import { useUserMarketPosition, useMarketInfo } from "@/hooks/useUserMarketPosition";
import { useMarketCardData } from "@/hooks/useMarketCardData";
import MarketOutcomeButtons from "./market/MarketOutcomeButtons";
import MarketStats from "./market/MarketStats";
import MarketTradeForm from "./market/MarketTradeForm";

/**
 * InfoFiMarketCard - Displays a single InfoFi market with live hybrid pricing
 * Refactored to delegate to focused sub-components (following mobile pattern)
 */
const InfoFiMarketCard = ({ market, marketInfo: batchMarketInfo, userPosition: batchUserPosition }) => {
  const { t } = useTranslation("market");
  const { currentSeasonQuery } = useRaffleRead();
  const fallbackSeasonId = currentSeasonQuery?.data ?? null;
  const seasonId = market?.raffle_id ?? market?.seasonId ?? fallbackSeasonId;
  const isWinnerPrediction =
    market.market_type === "WINNER_PREDICTION" &&
    market.player &&
    seasonId != null;
  const parts = buildMarketTitleParts(market);
  const title = market?.question || market?.market_type || t("market");
  const { isConnected, address } = useAccount();
  const { executeBatch } = useSmartTransactions();

  const qc = useQueryClient();
  const { toast } = useToast();

  // Use extracted data hook
  const {
    isLoadingPlayer,
    isLoadingOracle,
    playerHasTickets,
    percent,
  } = useMarketCardData(market, seasonId);

  // Derive effective market ID
  const effectiveMarketId = React.useMemo(() => {
    return market?.id != null ? String(market.id) : null;
  }, [market?.id]);

  // Fetch user positions and market info — use batch data from parent if available,
  // otherwise fall back to individual hooks (for standalone / detail page usage)
  const individualPosition = useUserMarketPosition(
    batchUserPosition ? null : effectiveMarketId
  );
  const positionData = batchUserPosition || individualPosition.data;
  const yesPos = {
    data: positionData ? { amount: positionData.yesAmount } : null,
    isLoading: !batchUserPosition && individualPosition.isLoading,
    error: !batchUserPosition ? individualPosition.error : null,
  };
  const noPos = {
    data: positionData ? { amount: positionData.noAmount } : null,
    isLoading: !batchUserPosition && individualPosition.isLoading,
    error: !batchUserPosition ? individualPosition.error : null,
  };

  const individualMarketInfo = useMarketInfo(
    batchMarketInfo ? null : effectiveMarketId
  );
  const marketInfo = {
    data: batchMarketInfo || individualMarketInfo.data || { totalYesPool: 0n, totalNoPool: 0n },
    isLoading: !batchMarketInfo && individualMarketInfo.isLoading,
  };

  // Trading form state
  const [form, setForm] = React.useState({ side: "YES", amount: "" });

  // Bet mutation
  const betMutation = useMutation({
    mutationFn: async () => {
      const amt = form.amount || "0";
      const calls = await buildPlaceBetCalls({
        prediction: form.side === "YES",
        amount: amt,
        account: address,
        fpmmAddress: market.contract_address,
      });
      return executeBatch(calls);
    },
    onSuccess: (hash) => {
      qc.invalidateQueries({
        queryKey: ["infofiBet", effectiveMarketId, address, true],
      });
      qc.invalidateQueries({
        queryKey: ["infofiBet", effectiveMarketId, address, false],
      });
      yesPos.refetch?.();
      noPos.refetch?.();
      setForm((f) => ({ ...f, amount: "" }));
      toast({
        title: t("betConfirmed"),
        description: t("betDetails", {
          side: form.side,
          amount: form.amount,
          hash: String(hash),
        }),
      });
    },
    onError: (e) => {
      toast({
        title: t("tradeFailed"),
        description: e?.message || t("transactionError"),
        variant: "destructive",
      });
    },
  });

  // Payout calculations
  const payoutPercent = percent;

  const calculatePayout = React.useCallback(
    (betAmount, isYes) => {
      const amount = Number(betAmount || 0);
      if (amount <= 0) return 0;

      const yesPercent = Number(payoutPercent);
      const noPercent = 100 - yesPercent;

      if (isYes) {
        return yesPercent > 0 ? amount / (yesPercent / 100) : 0;
      } else {
        return noPercent > 0 ? amount / (noPercent / 100) : 0;
      }
    },
    [payoutPercent],
  );

  const calculateProfit = React.useCallback(
    (betAmount, isYes) => {
      const payout = calculatePayout(betAmount, isYes);
      return Math.max(0, payout - Number(betAmount || 0));
    },
    [calculatePayout],
  );

  // Show skeleton loading state
  if (isLoadingPlayer || isLoadingOracle) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <CardHeader className="pb-3">
        <Link to={`/markets/${market.id}`} className="block">
          <CardTitle className="text-base font-medium leading-tight cursor-pointer hover:underline">
            {isWinnerPrediction ? (
              <span>
                {parts.prefix}{" "}
                <UsernameDisplay
                  address={market.player}
                  className="font-medium"
                />{" "}
                {parts.seasonLabel}
              </span>
            ) : (
              title
            )}
          </CardTitle>
        </Link>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Warning when player has 0 raffle tickets */}
        {isWinnerPrediction && playerHasTickets === false && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-amber-600">⚠️</span>
              <span className="text-amber-900 font-medium">
                {t("playerHasNoPosition")}
              </span>
            </div>
            <p className="text-amber-700 mt-1">
              {t("playerCannotWinUnlessReentry")}
            </p>
          </div>
        )}

        {/* Outcome buttons (YES/NO) */}
        <MarketOutcomeButtons
          percent={percent}
          selectedSide={form.side}
          onSelectSide={(side) => setForm({ ...form, side })}
          betAmount={form.amount}
          calculatePayout={calculatePayout}
          calculateProfit={calculateProfit}
        />

        {/* Market stats (volume, liquidity, positions) */}
        <MarketStats
          contractAddress={market.contract_address}
          marketInfo={marketInfo}
          isConnected={isConnected}
          yesPosition={yesPos}
          noPosition={noPos}
        />

        {/* Trade form (input + submit) */}
        <MarketTradeForm
          amount={form.amount}
          onAmountChange={(val) => setForm({ ...form, amount: val })}
          selectedSide={form.side}
          isConnected={isConnected}
          isSettled={market.is_settled}
          isActive={market.is_active}
          isPending={betMutation.isPending}
          onSubmit={() => betMutation.mutate()}
        />
      </CardContent>
    </Card>
  );
};

InfoFiMarketCard.propTypes = {
  market: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    question: PropTypes.string,
    market_type: PropTypes.string,
    raffle_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    player: PropTypes.string,
    contract_address: PropTypes.string,
    volume24h: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    volume: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    current_probability: PropTypes.number,
    current_probability_bps: PropTypes.number,
    yes_price: PropTypes.number,
    no_price: PropTypes.number,
    is_settled: PropTypes.bool,
    is_active: PropTypes.bool,
  }).isRequired,
  /** Batch-provided market info (pool reserves + volume). Skips individual fetch when provided. */
  marketInfo: PropTypes.object,
  /** Batch-provided user position data. Skips individual fetch when provided. */
  userPosition: PropTypes.object,
};

export default InfoFiMarketCard;
