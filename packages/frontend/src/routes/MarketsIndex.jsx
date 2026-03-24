// src/routes/MarketsIndex.jsx
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Filter, TrendingUp, Activity, Circle } from "lucide-react";
import InfoFiMarketCard from "@/components/infofi/InfoFiMarketCard";
import { useInfoFiMarkets } from "@/hooks/useInfoFiMarkets";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { usePlatform } from "@/hooks/usePlatform";
import { useMarketsBatchInfo } from "@/hooks/useMarketsBatchInfo";
import { useUserPositionsBatch } from "@/hooks/useUserPositionsBatch";
import MobileMarkets from "@/components/mobile/MobileMarkets";
import MarketCardSkeleton from "@/components/common/skeletons/MarketCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton shown while ProtectedRoute checks access.
 * Renders the page title + search bar placeholders + skeleton cards
 * so users see a layout instead of a blank spinner.
 */
export const MarketsLoadingSkeleton = () => (
  <div>
    <div className="mb-6">
      <Skeleton className="h-8 w-48 mb-2" />
      <Skeleton className="h-4 w-64" />
    </div>
    <div className="mb-6 flex flex-col sm:flex-row gap-3">
      <Skeleton className="h-10 flex-1 rounded-md" />
      <Skeleton className="h-10 w-64 rounded-md" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <MarketCardSkeleton key={i} />
      ))}
    </div>
  </div>
);

const MarketsIndex = () => {
  const { isMobile } = usePlatform();

  // Mobile view - render mobile component
  if (isMobile) {
    return <MobileMarkets />;
  }

  // Desktop view continues below
  return <DesktopMarketsIndex />;
};

const DesktopMarketsIndex = () => {
  const { t } = useTranslation("market");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all', 'active', 'settled'

  // Determine current active season and default to it
  const { data: seasons, isLoading: seasonsLoading } = useAllSeasons?.() || {
    data: [],
    isLoading: false,
  };
  const activeSeasonId = useMemo(() => {
    const arr = Array.isArray(seasons) ? seasons : [];
    const active = arr.find((s) => Number(s?.status) === 1);
    return active ? String(active.id ?? active.seasonId ?? "0") : "0";
  }, [seasons]);

  // Pass seasons to useInfoFiMarkets so it can query markets for each season
  const seasonsArray = useMemo(() => {
    return Array.isArray(seasons) ? seasons : [];
  }, [seasons]);

  // Build filters based on status filter
  const filters = useMemo(() => {
    const f = {};
    if (statusFilter === "active") {
      f.isActive = true;
    } else if (statusFilter === "settled") {
      f.isActive = false;
    }
    // 'all' means no isActive filter
    return f;
  }, [statusFilter]);

  const {
    markets,
    isLoading: marketsLoading,
    error,
    refetch,
  } = useInfoFiMarkets(seasonsArray, filters);

  // Collect all market IDs for batch fetching
  const allMarketIds = useMemo(() => {
    if (!markets || typeof markets !== "object") return [];
    return Object.values(markets)
      .flat()
      .map((m) => String(m.id))
      .filter(Boolean);
  }, [markets]);

  // Batch fetch market info and user positions at page level
  const { data: batchMarketInfo } = useMarketsBatchInfo(allMarketIds);
  const { data: batchUserPositions } = useUserPositionsBatch(allMarketIds);

  // Get bonding curve address from active season (commented out - not needed without arbitrage panel)
  // const bondingCurveAddress = useMemo(() => {
  //   const arr = Array.isArray(seasons) ? seasons : [];
  //   const active = arr.find((s) => Number(s?.status) === 1);
  //   return active?.config?.bondingCurve || null;
  // }, [seasons]);

  // Build a set of active season IDs for quick lookup
  const activeSeasonIds = useMemo(() => {
    const arr = Array.isArray(seasons) ? seasons : [];
    return new Set(
      arr
        .filter((s) => Number(s?.status) === 1)
        .map((s) => String(s.id ?? s.seasonId)),
    );
  }, [seasons]);

  // Filter and group markets by season and market type
  const groupedBySeason = useMemo(() => {
    if (!markets || typeof markets !== "object") return {};

    const result = {};

    Object.entries(markets).forEach(([seasonId, seasonMarkets]) => {
      const raw = Array.isArray(seasonMarkets) ? seasonMarkets : [];
      // Override is_active to false when parent season isn't active
      const marketArray = activeSeasonIds.has(seasonId)
        ? raw
        : raw.map((m) => ({ ...m, is_active: false }));

      // Apply search filter only (status filter already applied by backend)
      let filtered = marketArray;

      // Search filter (by player address)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(
          (m) =>
            m.player_address?.toLowerCase().includes(query) ||
            m.player?.toLowerCase().includes(query)
        );
      }

      // Group by market type
      const winners = filtered.filter(
        (m) => (m.market_type || m.type) === "WINNER_PREDICTION"
      );
      const positionSize = filtered.filter(
        (m) => (m.market_type || m.type) === "POSITION_SIZE"
      );
      const behavioral = filtered.filter(
        (m) => (m.market_type || m.type) === "BEHAVIORAL"
      );
      const known = new Set([
        "WINNER_PREDICTION",
        "POSITION_SIZE",
        "BEHAVIORAL",
      ]);
      const others = filtered.filter(
        (m) => !known.has(m.market_type || m.type || "")
      );

      // Only include season if it has markets after filtering
      if (
        winners.length > 0 ||
        positionSize.length > 0 ||
        behavioral.length > 0 ||
        others.length > 0
      ) {
        result[seasonId] = { winners, positionSize, behavioral, others };
      }
    });

    return result;
  }, [markets, searchQuery, activeSeasonIds]);

  // Calculate total markets count
  const totalMarketsCount = useMemo(() => {
    return Object.values(groupedBySeason).reduce((total, season) => {
      return (
        total +
        season.winners.length +
        season.positionSize.length +
        season.behavioral.length +
        season.others.length
      );
    }, 0);
  }, [groupedBySeason]);

  const isLoading = seasonsLoading || marketsLoading;

  return (
    <div>
      {/* Polymarket-style header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
            <p className="text-muted-foreground mt-1">
              {t("browseActiveMarkets")}
            </p>
          </div>
          {!seasonsLoading && activeSeasonId !== "0" && (
            <div className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                {t("activeSeason")}:
              </span>
              <span className="font-mono font-semibold">#{activeSeasonId}</span>
            </div>
          )}
        </div>
      </div>

      {/* Search and Filter Bar - Polymarket style */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by player address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Tabs
          value={statusFilter}
          onValueChange={setStatusFilter}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full sm:w-auto grid-cols-3">
            <TabsTrigger value="all" className="gap-1">
              <Filter className="h-3 w-3" />
              All
            </TabsTrigger>
            <TabsTrigger value="active" className="gap-1">
              <TrendingUp className="h-3 w-3" />
              Active
            </TabsTrigger>
            <TabsTrigger value="settled">Settled</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Results count */}
      {!isLoading && totalMarketsCount > 0 && (
        <div className="mb-4 text-sm text-muted-foreground">
          Showing {totalMarketsCount}{" "}
          {totalMarketsCount === 1 ? "market" : "markets"}
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      )}

      {/* Loading and error states */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6">
            <p className="text-red-600 text-center">Failed to load markets</p>
            <div className="text-center mt-4">
              <button
                type="button"
                className="px-3 py-1 text-sm rounded bg-red-100 hover:bg-red-200 text-red-700"
                onClick={() => refetch?.()}
              >
                Retry
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Markets grid - Polymarket style */}
      {!isLoading && !error && (
        <div className="space-y-8">
          {Object.keys(groupedBySeason).length === 0 && (
            <Card className="text-center py-12">
              <CardContent className="space-y-4">
                <div className="text-6xl mb-4">📊</div>
                <h3 className="text-lg font-semibold">No Markets Found</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  {searchQuery
                    ? `No markets match your search "${searchQuery}". Try a different search term.`
                    : "No prediction markets available yet. Markets are created automatically when players cross the 1% threshold."}
                </p>
                {searchQuery && (
                  <Button
                    variant="outline"
                    onClick={() => setSearchQuery("")}
                    className="mt-4"
                  >
                    Clear Search
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {Object.entries(groupedBySeason)
            .sort(([a], [b]) => {
              // Active seasons first, then by ID descending (newest first)
              const aActive = activeSeasonIds.has(a);
              const bActive = activeSeasonIds.has(b);
              if (aActive !== bActive) return bActive - aActive;
              return Number(b) - Number(a);
            })
            .map(([seasonId, seasonGrouped]) => (
            <div key={seasonId}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <a
                    href={`/raffle/${seasonId}`}
                    className="text-xl font-semibold hover:underline"
                  >
                    Season #{seasonId}
                  </a>
                  {activeSeasonIds.has(seasonId) ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
                      <Circle className="h-2 w-2 fill-current" />
                      {t("active")}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {t("ended")}
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">
                  {Object.values(seasonGrouped).flat().length} {t("markets")}
                </span>
              </div>

              <div className="space-y-6">
                {seasonGrouped.winners.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        {t("winnerPrediction")}
                      </h3>
                      <span className="text-sm text-muted-foreground">
                        {seasonGrouped.winners.length} {t("markets")}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {seasonGrouped.winners.map((m) => (
                        <InfoFiMarketCard
                        key={m.id}
                        market={m}
                        marketInfo={batchMarketInfo[String(m.id)]}
                        userPosition={batchUserPositions[String(m.id)]}
                      />
                      ))}
                    </div>
                  </div>
                )}

                {seasonGrouped.positionSize.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        {t("positionSize")}
                      </h3>
                      <span className="text-sm text-muted-foreground">
                        {seasonGrouped.positionSize.length} {t("markets")}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {seasonGrouped.positionSize.map((m) => (
                        <InfoFiMarketCard
                        key={m.id}
                        market={m}
                        marketInfo={batchMarketInfo[String(m.id)]}
                        userPosition={batchUserPositions[String(m.id)]}
                      />
                      ))}
                    </div>
                  </div>
                )}

                {seasonGrouped.behavioral.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        {t("behavioral")}
                      </h3>
                      <span className="text-sm text-muted-foreground">
                        {seasonGrouped.behavioral.length} {t("markets")}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {seasonGrouped.behavioral.map((m) => (
                        <InfoFiMarketCard
                        key={m.id}
                        market={m}
                        marketInfo={batchMarketInfo[String(m.id)]}
                        userPosition={batchUserPositions[String(m.id)]}
                      />
                      ))}
                    </div>
                  </div>
                )}

                {seasonGrouped.others.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">{t("other")}</h3>
                      <span className="text-sm text-muted-foreground">
                        {seasonGrouped.others.length} {t("markets")}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {seasonGrouped.others.map((m) => (
                        <InfoFiMarketCard
                        key={m.id}
                        market={m}
                        marketInfo={batchMarketInfo[String(m.id)]}
                        userPosition={batchUserPositions[String(m.id)]}
                      />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Arbitrage Opportunities - Hidden for now */}
      {/* {!seasonsLoading && activeSeasonId !== '0' && bondingCurveAddress && (
        <div className="mt-8">
          <ArbitrageOpportunityDisplay
            seasonId={activeSeasonId}
            bondingCurveAddress={bondingCurveAddress}
            minProfitability={2}
          />
        </div>
      )} */}
    </div>
  );
};

export default MarketsIndex;
