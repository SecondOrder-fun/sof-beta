// src/components/infofi/PositionsPanel.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { formatUnits } from "viem";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * PositionsPanel
 * Shared InfoFi positions panel used by AccountPage and UserProfile to avoid divergence.
 * Now fetches positions from the backend API (database) instead of blockchain.
 * Note: seasons prop is kept for backwards compatibility but not currently used.
 */
const PositionsPanel = ({ address, seasons = [], title, description }) => {
  const { t } = useTranslation("market");
  const defaultTitle = title || t("predictionMarketPositions");
  const defaultDescription = description || t("openPositionsAcross");

  // Acknowledge seasons prop to avoid lint warning (kept for backwards compatibility)
  if (seasons.length > 0) {
    // Future enhancement: could filter positions by season if needed
  }

  const positionsQuery = useQuery({
    queryKey: ["positionsPanel", address],
    enabled: !!address,
    queryFn: async () => {
      // Fetch positions from backend API
      const response = await fetch(`${API_BASE}/users/${address}/positions`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.details || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();
      const positions = data.positions || [];

      // Transform database positions to match expected format
      return positions.map((pos) => {
        // Convert amountWei string to BigInt for calculations
        // Backend sends wei representation as string to avoid precision loss
        const amountBig = pos.amountWei ? BigInt(pos.amountWei) : 0n;

        return {
          seasonId: pos.market?.seasonId || 0,
          marketId: pos.marketId,
          marketType: pos.market?.marketType || "Winner Prediction",
          outcome: pos.outcome,
          amountBig,
          amount: formatUnits(amountBig, 18) + " SOF",
          player: pos.market?.playerAddress || null,
          price: pos.price,
        };
      });
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{defaultTitle}</CardTitle>
        <CardDescription>{defaultDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {!address && (
          <p className="text-muted-foreground">{t("connectWalletToView")}</p>
        )}
        {address && (
          <div className="space-y-2">
            {positionsQuery.isLoading && (
              <p className="text-muted-foreground">{t("loadingPositions")}</p>
            )}
            {positionsQuery.error && (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  {positionsQuery.error.message?.includes("does not exist") ||
                  positionsQuery.error.message?.includes(
                    "No prediction markets"
                  )
                    ? t("noMarketsAvailable")
                    : `${t("errorLoadingPositions")}: ${
                        positionsQuery.error.message
                      }`}
                </p>
                {!positionsQuery.error.message?.includes("does not exist") &&
                  !positionsQuery.error.message?.includes(
                    "No prediction markets"
                  ) && (
                    <p className="text-sm text-muted-foreground">
                      Make sure the backend server is running on port 3000.
                    </p>
                  )}
              </div>
            )}
            {!positionsQuery.isLoading &&
              !positionsQuery.error &&
              (() => {
                const data = positionsQuery.data || [];
                if (data.length === 0)
                  return (
                    <p className="text-muted-foreground">
                      {t("noOpenPositions")}
                    </p>
                  );
                // Group by seasonId
                const bySeason = new Map();
                for (const row of data) {
                  const key = String(row.seasonId ?? "—");
                  if (!bySeason.has(key)) bySeason.set(key, []);
                  bySeason.get(key).push(row);
                }
                return (
                  <div className="space-y-3">
                    {Array.from(bySeason.entries()).map(([season, rows]) => {
                      const totalBig = rows.reduce(
                        (acc, r) => acc + (r.amountBig ?? 0n),
                        0n
                      );
                      const totalSof = formatUnits(totalBig, 18);
                      return (
                        <div key={season} className="border rounded">
                          <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                            <div className="text-sm font-medium">
                              {t("raffle:season")} #{season}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("subtotal")}:{" "}
                              <span className="font-mono">{totalSof}</span> SOF
                            </div>
                          </div>
                          <div className="p-2 space-y-2">
                            {rows.map((pos) => (
                              <div
                                key={`${pos.seasonId}-${pos.marketId}-${pos.outcome}`}
                                className="border rounded p-2 text-sm"
                              >
                                <div className="flex justify-between">
                                  <span className="font-medium">
                                    {pos.marketType || t("market")}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {t("common:id")}: {pos.marketId}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t("outcome")}: {pos.outcome || "—"} •{" "}
                                  {t("common:amount")}: {pos.amount || "—"}{" "}
                                  {pos.player
                                    ? `• ${t("player")}: ${pos.player}`
                                    : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

PositionsPanel.propTypes = {
  address: PropTypes.string,
  seasons: PropTypes.array,
  title: PropTypes.string,
  description: PropTypes.string,
};

export default PositionsPanel;
