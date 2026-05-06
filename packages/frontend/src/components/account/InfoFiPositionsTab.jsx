// src/components/account/InfoFiPositionsTab.jsx
import { useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import { readBet } from "@/services/onchainInfoFi";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const InfoFiPositionsTab = ({ address, addresses, originLabels }) => {
  const { t } = useTranslation(["account", "portfolio"]);
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  // Normalize input — single address or addresses array. Sorted lower-case
  // for cache-key stability (so `[eoa, sma]` and `[sma, eoa]` collide).
  const queryAddresses = useMemo(() => {
    const raw = addresses?.length ? addresses : address ? [address] : [];
    return Array.from(
      new Set(raw.filter(Boolean).map((a) => a.toLowerCase()))
    ).sort();
  }, [address, addresses]);

  const showOriginColumn =
    Array.isArray(addresses) &&
    addresses.length > 1 &&
    originLabels &&
    Object.keys(originLabels).length > 0;
  const seasonsQry = useAllSeasons();
  const seasonsArr = useMemo(
    () => {
      const seasons = seasonsQry.data;
      return Array.isArray(seasons) ? seasons : [];
    },
    [seasonsQry.data]
  );

  // Default to the active season (status === 1), fallback to highest ID
  const defaultSeasonId = useMemo(() => {
    if (seasonsArr.length === 0) return "0";
    const active = seasonsArr.find((s) => Number(s?.status) === 1);
    if (active) return String(active.id);
    const highest = seasonsArr.reduce((max, s) => (s.id > max.id ? s : max), seasonsArr[0]);
    return String(highest.id);
  }, [seasonsArr]);

  const [selectedSeasonId, setSelectedSeasonId] = useState("0");

  useEffect(() => {
    if (defaultSeasonId !== "0" && selectedSeasonId === "0") {
      setSelectedSeasonId(defaultSeasonId);
    }
  }, [defaultSeasonId, selectedSeasonId]);

  const selectedSeason = useMemo(
    () => seasonsArr.find((s) => String(s.id) === selectedSeasonId) || null,
    [seasonsArr, selectedSeasonId]
  );

  // Fetch trade history — fan out across each address, tag with origin,
  // dedupe by `(tx_hash, log_index)` so a tx that touches both EOA + SMA
  // counts once. Sort by block desc, then log desc for deterministic order.
  const tradesQuery = useQuery({
    queryKey: ["infofiTrades", queryAddresses],
    enabled: queryAddresses.length > 0,
    queryFn: async () => {
      const perAddress = await Promise.all(
        queryAddresses.map(async (addr) => {
          const url = `${
            import.meta.env.VITE_API_BASE_URL
          }/infofi/positions/${addr}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error("Failed to fetch trade history");
          }
          const data = await response.json();
          return (data.positions || []).map((row) => ({
            ...row,
            origin: addr,
          }));
        })
      );

      const merged = perAddress.flat();
      const seen = new Set();
      const deduped = [];
      for (const row of merged) {
        const hash = (row.tx_hash || row.hash || "").toLowerCase();
        const li = row.log_index ?? row.logIndex ?? "";
        const key = `${hash}:${li}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
      }

      deduped.sort((a, b) => {
        const aBn = Number(a.block_number ?? a.blockNumber ?? 0);
        const bBn = Number(b.block_number ?? b.blockNumber ?? 0);
        if (bBn !== aBn) return bBn - aBn;
        const aLi = Number(a.log_index ?? a.logIndex ?? 0);
        const bLi = Number(b.log_index ?? b.logIndex ?? 0);
        return bLi - aLi;
      });

      return deduped;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const positionsQuery = useQuery({
    queryKey: [
      "infofiPositionsOnchainActive",
      queryAddresses,
      selectedSeason?.id,
      netKey,
    ],
    enabled: queryAddresses.length > 0 && !!selectedSeason,
    queryFn: async () => {
      const seasonId = selectedSeason.id;

      // Fetch markets from Supabase (includes contract_address)
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/infofi/markets?seasonId=${seasonId}&isActive=true`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch markets");
      }

      const data = await response.json();
      const markets = data.markets?.[seasonId] || [];

      if (!markets || markets.length === 0) {
        return { positions: [], marketIds: [] };
      }

      const marketIds = markets.map((m) => m.id);
      const positions = [];

      for (const m of markets) {
        try {
          const fpmmAddress = m.contract_address;

          if (
            !fpmmAddress ||
            fpmmAddress === "0x0000000000000000000000000000000000000000"
          ) {
            continue;
          }

          for (const addr of queryAddresses) {
            // eslint-disable-next-line no-await-in-loop
            const yes = await readBet({
              marketId: m.id,
              account: addr,
              prediction: true,
              networkKey: netKey,
              fpmmAddress,
            });
            // eslint-disable-next-line no-await-in-loop
            const no = await readBet({
              marketId: m.id,
              account: addr,
              prediction: false,
              networkKey: netKey,
              fpmmAddress,
            });

            const yesAmt = yes?.amount ?? 0n;
            const noAmt = no?.amount ?? 0n;

            if (yesAmt > 0n || noAmt > 0n) {
              positions.push({
                marketId: m.id,
                marketName: m.question || m.market_type || "Market",
                player: m.player_address,
                fpmmAddress,
                yesAmount: yesAmt,
                noAmount: noAmt,
                origin: addr,
              });
            }
          }
        } catch {
          // Skip markets that fail to read
        }
      }

      return { positions, marketIds };
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  // Build set of all market IDs belonging to the selected season
  const seasonMarketIds = useMemo(() => {
    const ids = positionsQuery.data?.marketIds || [];
    return new Set(ids.map((id) => String(id)));
  }, [positionsQuery.data]);

  // Group trades by market, filtered to the selected season's markets
  const tradesByMarket = useMemo(() => {
    const trades = tradesQuery.data || [];
    const grouped = {};

    for (const trade of trades) {
      const marketId = String(trade.market_id);
      // Only include trades for markets in the selected season
      if (seasonMarketIds.size > 0 && !seasonMarketIds.has(marketId)) continue;
      if (!grouped[marketId]) {
        grouped[marketId] = [];
      }
      grouped[marketId].push(trade);
    }

    return grouped;
  }, [tradesQuery.data, seasonMarketIds]);

  return (
    <div className="h-80 overflow-y-auto overflow-x-hidden pr-1">
      {seasonsArr.length === 0 && (
        <p className="text-muted-foreground">No active season found.</p>
      )}
      {seasonsArr.length > 0 && (
        <>
          <Select
            value={selectedSeasonId}
            onValueChange={setSelectedSeasonId}
          >
            <SelectTrigger className="w-full mb-3">
              <SelectValue placeholder="Select season" />
            </SelectTrigger>
            <SelectContent>
              {seasonsArr.map((s) => {
                const id = String(s.id);
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
          {(positionsQuery.isLoading || tradesQuery.isLoading) && (
            <p className="text-muted-foreground">Loading positions...</p>
          )}
          {(positionsQuery.error || tradesQuery.error) && (
            <p className="text-red-500">
              {positionsQuery.error?.message?.includes("does not exist") ||
              positionsQuery.error?.message?.includes("No prediction markets")
                ? "No prediction markets available yet."
                : `Error: ${String(
                    positionsQuery.error?.message ||
                      tradesQuery.error?.message ||
                      positionsQuery.error ||
                      tradesQuery.error
                  )}`}
            </p>
          )}
          {!positionsQuery.isLoading &&
            !tradesQuery.isLoading &&
            !positionsQuery.error &&
            !tradesQuery.error && (
              <>
                {(positionsQuery.data?.positions || []).length === 0 &&
                  Object.keys(tradesByMarket).length === 0 && (
                    <p className="text-muted-foreground">
                      No positions or trades found.
                    </p>
                  )}
                {Object.keys(tradesByMarket).length > 0 && (
                  <Accordion type="multiple" className="space-y-2">
                    {Object.entries(tradesByMarket).map(
                      ([marketId, marketTrades]) => {
                        // When merged across EOA + SMA, multiple positions
                        // can exist per market — sum Yes/No across them.
                        const marketPositions = (
                          positionsQuery.data?.positions || []
                        ).filter((p) => p.marketId === parseInt(marketId));
                        const hasOnchainPos = marketPositions.length > 0;

                        const yesAmtSum = marketPositions.reduce(
                          (s, p) => s + (p.yesAmount ?? 0n),
                          0n
                        );
                        const noAmtSum = marketPositions.reduce(
                          (s, p) => s + (p.noAmount ?? 0n),
                          0n
                        );

                        // Pick a representative position for display metadata
                        const pos = marketPositions[0] || null;

                        // Calculate Yes/No totals from trades when no on-chain position
                        const yesTotal = hasOnchainPos
                          ? null
                          : marketTrades
                              .filter((t) => t.outcome === "YES")
                              .reduce(
                                (sum, t) => sum + parseFloat(t.amount || 0),
                                0
                              );
                        const noTotal = hasOnchainPos
                          ? null
                          : marketTrades
                              .filter((t) => t.outcome === "NO")
                              .reduce(
                                (sum, t) => sum + parseFloat(t.amount || 0),
                                0
                              );

                        // Distinct origins across this market's positions +
                        // trades, deduped, render as badges.
                        const originsForMarket = showOriginColumn
                          ? Array.from(
                              new Set(
                                [
                                  ...marketPositions
                                    .map((p) => p.origin?.toLowerCase())
                                    .filter(Boolean),
                                  ...marketTrades
                                    .map((tr) =>
                                      (
                                        tr.origin ||
                                        tr.user_address ||
                                        ""
                                      ).toLowerCase()
                                    )
                                    .filter(Boolean),
                                ]
                              )
                            )
                          : [];

                        return (
                          <AccordionItem
                            key={`market-${marketId}`}
                            value={`market-${marketId}`}
                          >
                            <AccordionTrigger className="px-3 py-2 text-left">
                              <div className="flex items-center justify-between w-full gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-medium text-foreground truncate">
                                    #{marketId} - {pos?.marketName || "Market"}
                                  </span>
                                  {originsForMarket.map((origin) => {
                                    const label =
                                      originLabels?.[origin] || null;
                                    if (!label) return null;
                                    return (
                                      <TooltipProvider key={origin}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Badge
                                              variant={
                                                label === "SMA"
                                                  ? "default"
                                                  : "outline"
                                              }
                                              className="text-[10px] px-1.5 py-0 leading-tight cursor-default"
                                            >
                                              {label}
                                            </Badge>
                                          </TooltipTrigger>
                                          <TooltipContent side="top">
                                            <span className="font-mono text-xs">
                                              {origin}
                                            </span>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    );
                                  })}
                                </div>
                                <div className="text-right shrink-0 flex items-center gap-2">
                                  <span className="font-bold text-green-600">
                                    {hasOnchainPos
                                      ? Number(
                                          formatUnits(yesAmtSum, 18)
                                        ).toFixed(0)
                                      : (yesTotal ?? 0).toFixed(0)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    /
                                  </span>
                                  <span className="font-bold text-red-600">
                                    {hasOnchainPos
                                      ? Number(
                                          formatUnits(noAmtSum, 18)
                                        ).toFixed(0)
                                      : (noTotal ?? 0).toFixed(0)}
                                  </span>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="mt-2 pt-1 space-y-3">
                                {pos?.fpmmAddress && (
                                  <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground font-mono truncate">
                                      {t("account:marketContract")}: {pos.fpmmAddress.slice(0, 6)}...{pos.fpmmAddress.slice(-4)}
                                    </span>
                                    <a
                                      href={`https://sepolia.basescan.org/address/${pos.fpmmAddress}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:text-primary/80 flex items-center shrink-0 ml-2"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                )}
                                {contracts.CONDITIONAL_TOKENS && (
                                  <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground font-mono truncate">
                                      {t("account:conditionalToken")}: {contracts.CONDITIONAL_TOKENS.slice(0, 6)}...{contracts.CONDITIONAL_TOKENS.slice(-4)}
                                    </span>
                                    <a
                                      href={`https://sepolia.basescan.org/address/${contracts.CONDITIONAL_TOKENS}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:text-primary/80 flex items-center shrink-0 ml-2"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                )}
                                <Link
                                  to={`/markets/${marketId}`}
                                  className="flex items-center justify-between p-3 bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                                >
                                  <span className="text-foreground font-medium">
                                    Go to Market
                                  </span>
                                  <ChevronRight className="h-4 w-4 text-primary" />
                                </Link>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      }
                    )}
                  </Accordion>
                )}
              </>
            )}
        </>
      )}
    </div>
  );
};

InfoFiPositionsTab.propTypes = {
  address: PropTypes.string,
  addresses: PropTypes.arrayOf(PropTypes.string),
  originLabels: PropTypes.objectOf(PropTypes.string),
};

export default InfoFiPositionsTab;
