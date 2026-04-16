// src/pages/InfoFiMarketDetail.jsx
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PropTypes from "prop-types";
import { ArrowLeft, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OddsChart from "@/components/infofi/OddsChart";
import BuySellWidget from "@/components/infofi/BuySellWidget";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import ExplorerLink from "@/components/common/ExplorerLink";
import { useQuery } from "@tanstack/react-query";
import { useRaffleRead } from "@/hooks/useRaffleRead";
import { formatDistanceToNow, format } from "date-fns";
import { usePlatform } from "@/hooks/usePlatform";
import MobileMarketDetail from "@/components/mobile/MobileMarketDetail";

import { API_BASE } from "@/lib/apiBase";

/**
 * InfoFiMarketDetail Page
 * Displays detailed market information with odds-over-time chart and trading interface
 */
const InfoFiMarketDetail = () => {
  const { marketId } = useParams();
  const { t } = useTranslation("market");
  const { isMobile } = usePlatform();

  // Fetch market data from backend API
  const { data: marketData, isLoading } = useQuery({
    queryKey: ["infofiMarket", marketId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/infofi/markets/${marketId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch market");
      }
      const data = await response.json();
      return data.market;
    },
    enabled: Boolean(marketId),
    staleTime: 30000,
  });

  const market = marketData;

  const { currentSeasonQuery } = useRaffleRead();
  const seasonId =
    market?.raffle_id ??
    market?.seasonId ??
    market?.season_id ??
    currentSeasonQuery?.data;

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">{t("marketNotFound")}</p>
            <Link to="/markets">
              <Button className="mt-4" variant="outline">
                {t("backToMarkets")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Mobile detail view
  if (isMobile) {
    return <MobileMarketDetail market={market} marketId={marketId} />;
  }

  const isWinnerPrediction = market.market_type === "WINNER_PREDICTION";

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Back button */}
      <Link
        to="/markets"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToMarkets")}
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - 2/3 width on large screens */}
        <div className="lg:col-span-2 space-y-6">
          {/* Market header */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <CardTitle className="text-xl font-bold text-muted-foreground">
                    {isWinnerPrediction ? (
                      <>
                        Will{" "}
                        <Link
                          to={`/users/${market.player}`}
                          className="text-muted-foreground underline hover:text-foreground"
                        >
                          <UsernameDisplay
                            address={market.player}
                            className="font-bold"
                          />
                        </Link>{" "}
                        win{" "}
                        <Link
                          to={`/raffles/${seasonId}`}
                          className="text-muted-foreground underline hover:text-foreground"
                        >
                          Raffle Season {seasonId}
                        </Link>
                        ?
                      </>
                    ) : (
                      market.question || market.market_type
                    )}
                  </CardTitle>

                  {/* Market metadata */}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>
                        {market.created_at
                          ? formatDistanceToNow(new Date(market.created_at), {
                              addSuffix: true,
                            })
                          : t("unknown")}
                      </span>
                    </div>
                    <div className="font-medium">
                      ${(market.volume || 0).toLocaleString()} {t("volume")}
                    </div>
                  </div>
                </div>

                {/* Current odds display */}
                <div className="text-right">
                  <div className="text-3xl font-bold text-emerald-600">
                    {((market.current_probability || 0) / 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("yesOdds")}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {/* Odds over time chart */}
              <OddsChart marketId={marketId} />
            </CardContent>
          </Card>

          {/* Market details tabs */}
          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="activity">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
                  <TabsTrigger value="holders">{t("topHolders")}</TabsTrigger>
                  <TabsTrigger value="info">{t("marketInfo")}</TabsTrigger>
                </TabsList>

                <TabsContent value="activity" className="mt-4">
                  <ActivityFeed marketId={marketId} />
                </TabsContent>

                <TabsContent value="holders" className="mt-4">
                  <TopHolders marketId={marketId} />
                </TabsContent>

                <TabsContent value="info" className="mt-4">
                  <MarketInfo
                    market={market}
                    marketId={marketId}
                    seasonId={seasonId}
                    isWinnerPrediction={isWinnerPrediction}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Buy/Sell widget */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <BuySellWidget marketId={marketId} market={market} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Activity Feed ───────────────────────────────────────────

const ActivityFeed = ({ marketId }) => {
  const { t } = useTranslation("market");

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketTrades", marketId],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE}/infofi/markets/${marketId}/trades?limit=50`
      );
      if (!response.ok) throw new Error("Failed to fetch trades");
      return response.json();
    },
    enabled: Boolean(marketId),
    staleTime: 15000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3">
            <div className="h-4 bg-gray-200 rounded w-32"></div>
            <div className="h-4 bg-gray-200 rounded w-16"></div>
            <div className="h-4 bg-gray-200 rounded w-20"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("failedToLoadActivity") || "Failed to load activity."}
      </p>
    );
  }

  const trades = data?.trades || [];

  if (trades.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("noActivityYet") || "No activity yet."}
      </p>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-border">
      {trades.map((trade) => (
        <div
          key={trade.id}
          className="flex items-center justify-between py-3 text-sm"
        >
          <div className="flex items-center gap-3 min-w-0">
            <UsernameDisplay
              address={trade.user_address}
              linkTo={`/users/${trade.user_address}`}
              className="font-medium truncate"
            />
            <span
              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                trade.outcome === "YES"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
              }`}
            >
              {trade.outcome}
            </span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground shrink-0">
            <span className="font-medium text-foreground">
              {parseFloat(trade.amount || 0).toFixed(2)} SOF
            </span>
            <span className="text-xs">
              {trade.created_at
                ? formatDistanceToNow(new Date(trade.created_at), {
                    addSuffix: true,
                  })
                : ""}
            </span>
            {trade.tx_hash && (
              <ExplorerLink
                value={trade.tx_hash}
                type="tx"
                text="↗"
                className="text-xs text-primary hover:underline"
                showCopy={false}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Top Holders ─────────────────────────────────────────────

const TopHolders = ({ marketId }) => {
  const { t } = useTranslation("market");

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketHolders", marketId],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE}/infofi/markets/${marketId}/holders`
      );
      if (!response.ok) throw new Error("Failed to fetch holders");
      return response.json();
    },
    enabled: Boolean(marketId),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-16"></div>
            <div className="h-4 bg-gray-200 rounded w-full"></div>
            <div className="h-4 bg-gray-200 rounded w-full"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("failedToLoadHolders") || "Failed to load holders."}
      </p>
    );
  }

  const yesHolders = data?.yes || [];
  const noHolders = data?.no || [];

  if (yesHolders.length === 0 && noHolders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("noHoldersYet") || "No holders yet."}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {/* YES Holders */}
      <div>
        <h4 className="text-sm font-semibold text-emerald-600 mb-3 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          {t("yes") || "YES"} Holders
        </h4>
        {yesHolders.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <div className="space-y-2">
            {yesHolders.map((holder, i) => (
              <div
                key={holder.address}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground text-xs w-4">
                    #{i + 1}
                  </span>
                  <UsernameDisplay
                    address={holder.address}
                    linkTo={`/users/${holder.address}`}
                    className="truncate"
                  />
                </div>
                <span className="font-medium shrink-0">
                  {parseFloat(holder.total_amount || 0).toFixed(2)} SOF
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* NO Holders */}
      <div>
        <h4 className="text-sm font-semibold text-rose-600 mb-3 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-rose-500"></div>
          {t("no") || "NO"} Holders
        </h4>
        {noHolders.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <div className="space-y-2">
            {noHolders.map((holder, i) => (
              <div
                key={holder.address}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground text-xs w-4">
                    #{i + 1}
                  </span>
                  <UsernameDisplay
                    address={holder.address}
                    linkTo={`/users/${holder.address}`}
                    className="truncate"
                  />
                </div>
                <span className="font-medium shrink-0">
                  {parseFloat(holder.total_amount || 0).toFixed(2)} SOF
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Market Info ─────────────────────────────────────────────

const MarketInfo = ({ market, marketId, seasonId, isWinnerPrediction }) => {
  const { t } = useTranslation("market");

  return (
    <div className="space-y-4">
      {/* Market ID */}
      <InfoRow label={t("marketId") || "Market ID"}>
        <span className="font-mono text-sm">{marketId}</span>
      </InfoRow>

      {/* Contract Address */}
      {market.contract_address && (
        <InfoRow label={t("contractAddress") || "Contract Address"}>
          <div className="flex items-center gap-2">
            <ExplorerLink
              value={market.contract_address}
              type="address"
              className="font-mono text-xs break-all"
              showCopy={true}
            />
          </div>
        </InfoRow>
      )}

      {/* Market Type */}
      <InfoRow label={t("marketType") || "Market Type"}>
        <span className="text-sm px-2 py-0.5 rounded bg-muted">
          {market.market_type}
        </span>
      </InfoRow>

      {/* Season */}
      {seasonId && (
        <InfoRow label={t("season") || "Season"}>
          <Link
            to={`/raffles/${seasonId}`}
            className="text-sm text-primary hover:underline"
          >
            Season {seasonId}
          </Link>
        </InfoRow>
      )}

      {/* Player (for WINNER_PREDICTION) */}
      {isWinnerPrediction && market.player && (
        <InfoRow label={t("player") || "Player"}>
          <UsernameDisplay
            address={market.player}
            linkTo={`/users/${market.player}`}
            className="text-sm"
          />
        </InfoRow>
      )}

      {/* Status */}
      <InfoRow label={t("status") || "Status"}>
        <span
          className={`text-sm font-medium ${
            market.is_active
              ? "text-emerald-600"
              : market.is_settled
                ? "text-amber-600"
                : "text-muted-foreground"
          }`}
        >
          {market.is_active
            ? t("active") || "Active"
            : market.is_settled
              ? t("settled") || "Settled"
              : t("inactive") || "Inactive"}
        </span>
      </InfoRow>

      {/* Created */}
      {market.created_at && (
        <InfoRow label={t("created") || "Created"}>
          <span className="text-sm">
            {format(new Date(market.created_at), "MMM d, yyyy HH:mm")}
          </span>
        </InfoRow>
      )}

      {/* Description */}
      {market.description && (
        <InfoRow label={t("description") || "Description"}>
          <p className="text-sm text-muted-foreground">{market.description}</p>
        </InfoRow>
      )}
    </div>
  );
};

const InfoRow = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-b-0">
    <span className="text-sm text-muted-foreground shrink-0">{label}</span>
    <div className="text-right">{children}</div>
  </div>
);

ActivityFeed.propTypes = {
  marketId: PropTypes.string.isRequired,
};

TopHolders.propTypes = {
  marketId: PropTypes.string.isRequired,
};

MarketInfo.propTypes = {
  market: PropTypes.shape({
    contract_address: PropTypes.string,
    market_type: PropTypes.string,
    player: PropTypes.string,
    is_active: PropTypes.bool,
    is_settled: PropTypes.bool,
    created_at: PropTypes.string,
    description: PropTypes.string,
  }).isRequired,
  marketId: PropTypes.string.isRequired,
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  isWinnerPrediction: PropTypes.bool,
};

InfoRow.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

export default InfoFiMarketDetail;
