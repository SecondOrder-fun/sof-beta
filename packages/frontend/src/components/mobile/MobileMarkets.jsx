// src/components/mobile/MobileMarkets.jsx
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MobileMarketsList from "@/components/mobile/MobileMarketsList";
import { useInfoFiMarkets } from "@/hooks/useInfoFiMarkets";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { useUserPositionsBatch } from "@/hooks/useUserPositionsBatch";
import MobileCardSkeleton from "@/components/common/skeletons/MobileCardSkeleton";

/**
 * MobileMarkets - Mobile-first InfoFi Markets page
 * Select dropdown for season + Tabs for market type + MobileMarketsList carousel
 */
const MobileMarkets = () => {
  const { t } = useTranslation(["market", "common"]);

  // Get all seasons
  const { data: seasons, isLoading: seasonsLoading } = useAllSeasons?.() || {
    data: [],
    isLoading: false,
  };

  const seasonsArr = useMemo(
    () => (Array.isArray(seasons) ? seasons : []),
    [seasons]
  );

  // Fetch markets for ALL seasons upfront so we can find the best default
  const {
    markets: allMarkets,
    isLoading: marketsLoading,
    error,
  } = useInfoFiMarkets(seasonsArr, { isActive: true });

  // Batch fetch user positions for all markets
  const allMarketIds = useMemo(() => {
    if (!allMarkets || typeof allMarkets !== "object") return [];
    return Object.values(allMarkets)
      .flat()
      .map((m) => String(m.id))
      .filter(Boolean);
  }, [allMarkets]);

  const { data: batchPositions } = useUserPositionsBatch(allMarketIds);

  // Compute smart default: prefer the active season if it has markets,
  // otherwise fall back to the most recent (highest ID) season with markets.
  const defaultSeasonId = useMemo(() => {
    if (!allMarkets || typeof allMarkets !== "object") return "0";
    // Prefer the active season if it has markets
    const active = seasonsArr.find((s) => Number(s?.status) === 1);
    if (active) {
      const activeId = String(active.id ?? active.seasonId);
      if (Array.isArray(allMarkets[activeId]) && allMarkets[activeId].length > 0) {
        return activeId;
      }
    }
    // Fallback: most recent (highest ID) season with markets
    const seasonIds = Object.keys(allMarkets).sort(
      (a, b) => Number(b) - Number(a),
    );
    const withMarkets = seasonIds.find(
      (id) => Array.isArray(allMarkets[id]) && allMarkets[id].length > 0,
    );
    return withMarkets || "0";
  }, [allMarkets, seasonsArr]);

  const [selectedSeasonId, setSelectedSeasonId] = useState("0");
  const [selectedMarketType, setSelectedMarketType] =
    useState("WINNER_PREDICTION");

  // Set initial season once default is computed
  useEffect(() => {
    if (defaultSeasonId !== "0" && selectedSeasonId === "0") {
      setSelectedSeasonId(defaultSeasonId);
    }
  }, [defaultSeasonId, selectedSeasonId]);

  // Check if the selected season is active (status === 1)
  const isSelectedSeasonActive = useMemo(() => {
    const season = seasonsArr.find(
      (s) => String(s.id ?? s.seasonId) === selectedSeasonId,
    );
    return season ? Number(season.status) === 1 : false;
  }, [seasonsArr, selectedSeasonId]);

  // Get markets for selected season from the all-seasons data.
  // Override is_active to false when the parent season isn't active.
  const seasonMarkets = useMemo(() => {
    if (!allMarkets || typeof allMarkets !== "object") return [];
    const marketArray = allMarkets[selectedSeasonId] || [];
    const arr = Array.isArray(marketArray) ? marketArray : [];
    if (isSelectedSeasonActive) return arr;
    return arr.map((m) => ({ ...m, is_active: false }));
  }, [allMarkets, selectedSeasonId, isSelectedSeasonActive]);

  // Group markets by type
  const marketsByType = useMemo(() => {
    const winners = seasonMarkets.filter(
      (m) => (m.market_type || m.type) === "WINNER_PREDICTION"
    );
    const positionSize = seasonMarkets.filter(
      (m) => (m.market_type || m.type) === "POSITION_SIZE"
    );
    const behavioral = seasonMarkets.filter(
      (m) => (m.market_type || m.type) === "BEHAVIORAL"
    );

    return {
      WINNER_PREDICTION: winners,
      POSITION_SIZE: positionSize,
      BEHAVIORAL: behavioral,
    };
  }, [seasonMarkets]);

  // Get filtered markets for selected type
  const filteredMarkets = useMemo(() => {
    return marketsByType[selectedMarketType] || [];
  }, [marketsByType, selectedMarketType]);

  // Only show types that have markets
  const availableTypes = useMemo(() => {
    const labels = {
      WINNER_PREDICTION: "Win?",
      POSITION_SIZE: "Tix #",
      BEHAVIORAL: "Hodl/Dump?",
    };
    return Object.entries(marketsByType)
      .filter(([, arr]) => arr.length > 0)
      .map(([type, arr]) => ({
        type,
        label: labels[type] || type,
        count: arr.length,
      }));
  }, [marketsByType]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Page Title — always visible */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground text-left">
          {t("market:infoFiMarkets")}
        </h1>
      </div>

      {/* Error State */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-6 text-center">
            <p className="text-destructive">
              {t("market:failedToLoadMarkets")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Skeleton while seasons are loading (no dropdown to show yet) */}
      {seasonsLoading && <MobileCardSkeleton />}

      {/* Main content — show as soon as seasons are loaded */}
      {!seasonsLoading && !error && seasonsArr.length > 0 && (
        <div className="space-y-4">
          {/* Season Select dropdown */}
          <Select
            value={selectedSeasonId}
            onValueChange={setSelectedSeasonId}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select season" />
            </SelectTrigger>
            <SelectContent>
              {seasonsArr.map((s) => {
                const id = String(s.id ?? s.seasonId);
                const isActive = Number(s.status) === 1;
                return (
                  <SelectItem key={id} value={id}>
                    Season #{id}
                    {s.config?.name ? ` - ${s.config.name}` : ""}
                    {isActive ? " (Active)" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Market Type Tabs — show once markets have loaded */}
          {!marketsLoading && availableTypes.length > 0 && (
            <Tabs
              value={selectedMarketType}
              onValueChange={setSelectedMarketType}
            >
              <TabsList className="w-full">
                {availableTypes.map((mt) => (
                  <TabsTrigger
                    key={mt.type}
                    value={mt.type}
                    className="flex-1 text-xs"
                  >
                    {mt.label} ({mt.count})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {/* Markets Carousel (shows skeleton internally while loading) */}
          <MobileMarketsList
            markets={filteredMarkets}
            isLoading={marketsLoading}
            batchPositions={batchPositions}
          />

          {/* No Markets for this type */}
          {!marketsLoading &&
            filteredMarkets.length === 0 && (
              <Card className="text-center py-12">
                <CardContent className="space-y-4">
                  <div className="text-6xl mb-4">📊</div>
                  <h3 className="text-lg font-semibold">
                    {t("market:noMarketsAvailable")}
                  </h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    {t("market:noMarketsDescription", {
                      marketType: selectedMarketType
                        .toLowerCase()
                        .replace("_", " "),
                    })}
                  </p>
                </CardContent>
              </Card>
            )}
        </div>
      )}

      {/* No Seasons State */}
      {!seasonsLoading && !error && seasonsArr.length === 0 && (
        <Card className="text-center py-12">
          <CardContent className="space-y-4">
            <div className="text-6xl mb-4">🎲</div>
            <h3 className="text-lg font-semibold">
              {t("market:noSeasonsAvailable")}
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {t("market:noSeasonsDescription")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MobileMarkets;
