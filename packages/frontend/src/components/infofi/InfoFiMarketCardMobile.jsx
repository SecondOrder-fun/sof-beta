// src/components/infofi/InfoFiMarketCardMobile.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import BettingInterface from "./BettingInterface";
import { useAccount } from "wagmi";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { placeBetTx } from "@/services/onchainInfoFi";
import { useToast } from "@/hooks/useToast";

/**
 * InfoFiMarketCardMobile - Mobile-optimized single market card with betting interface
 * @param {Object} props
 * @param {Object} props.market - Market data
 */
const InfoFiMarketCardMobile = ({ market }) => {
  const { isConnected } = useAccount();
  const { toast } = useToast();
  const { t } = useTranslation(["market", "common"]);
  const queryClient = useQueryClient();

  // Place bet mutation
  const placeBetMutation = useMutation({
    mutationFn: async ({ marketId, side, amount }) => {
      if (!market.contract_address) {
        throw new Error(t("market:marketContractAddressNotFound"));
      }

      return placeBetTx({
        fpmmAddress: market.contract_address,
        marketId: marketId,
        prediction: side === "YES",
        amount: amount,
      });
    },
    onSuccess: () => {
      toast({
        title: t("market:betPlaced"),
        description: t("market:betConfirmed"),
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["infofi"] });
      queryClient.invalidateQueries({ queryKey: ["infofiBet"] });
    },
    onError: (error) => {
      toast({
        title: t("market:betFailed"),
        description: error.message || t("market:transactionError"),
        variant: "destructive",
      });
    },
  });

  const handleBet = (betData) => {
    placeBetMutation.mutate(betData);
  };

  // Show skeleton if market data is loading
  if (!market) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <Skeleton className="h-8 w-full mb-4" />
          <Skeleton className="h-32 w-full mb-4" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-2 border-border bg-card">
      <CardContent className="p-4">
        {/* Betting Interface (includes dynamic market question + player) */}
        <BettingInterface
          market={market}
          onBet={handleBet}
          isConnected={isConnected}
          isLoading={placeBetMutation.isPending}
        />

        {/* Status indicator */}
        <div className="mt-3 pt-3 border-t border-border flex justify-center">
          {market.is_active ? (
            <span className="text-xs font-medium text-green-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {t("market:pending")}
            </span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              {t("market:resolved")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

InfoFiMarketCardMobile.propTypes = {
  market: PropTypes.object,
};

export default InfoFiMarketCardMobile;
