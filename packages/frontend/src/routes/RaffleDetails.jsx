// src/routes/RaffleDetails.jsx
import { useState, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRaffleState } from "@/hooks/useRaffleState";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import PageTitle from "@/components/layout/PageTitle";
import { formatUnits } from "viem";
// removed inline buy/sell form controls
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { useChainTime } from "@/hooks/useChainTime";
import { useCurveState } from "@/hooks/useCurveState";
import BondingCurvePanel from "@/components/curve/CurveGraph";
import BuySellWidget from "@/components/curve/BuySellWidget";
import TransactionsTab from "@/components/curve/TransactionsTab";
import TokenInfoTab from "@/components/curve/TokenInfoTab";
import HoldersTab from "@/components/curve/HoldersTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurveEvents } from "@/hooks/useCurveEvents";
import { useStaggeredRefresh } from "@/hooks/useStaggeredRefresh";
import { usePlayerPosition } from "@/hooks/usePlayerPosition";
import { useAccount } from "wagmi";
import { RaffleAdminControls } from "@/components/admin/RaffleAdminControls";
import { TreasuryControls } from "@/components/admin/TreasuryControls";
import SecondaryCard from "@/components/common/SecondaryCard";
import ExplorerLink from "@/components/common/ExplorerLink";
import CountdownTimer from "@/components/common/CountdownTimer";
import { formatTimestamp } from "@/lib/utils";
import { usePlatform } from "@/hooks/usePlatform";
import MobileRaffleDetail from "@/components/mobile/MobileRaffleDetail";
import BuySellSheet from "@/components/mobile/BuySellSheet";
import PasswordGateModal from "@/components/gating/PasswordGateModal";
import SignatureGateModal from "@/components/gating/SignatureGateModal";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import { SponsoredPrizesDisplay } from "@/components/prizes/SponsoredPrizesDisplay";
import { SponsorPrizeWidget } from "@/components/prizes/SponsorPrizeWidget";
import { ClaimPrizeWidget } from "@/components/prizes/ClaimPrizeWidget";
import { useSeasonWinnerSummary } from "@/hooks/useSeasonWinnerSummaries";
import { useSeasonGating, GateType } from "@/hooks/useSeasonGating";


const RaffleDetails = () => {
  const { t } = useTranslation("raffle");
  const { seasonId } = useParams();
  const seasonIdNumber = Number(seasonId);
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get("mode");
  const initialTradeTab =
    modeParam === "sell" || modeParam === "buy" ? modeParam : undefined;
  const { seasonDetailsQuery } = useRaffleState(seasonIdNumber);
  const bondingCurveAddress = seasonDetailsQuery?.data?.config?.bondingCurve;
  const chainNow = useChainTime();
  const [activeTab, setActiveTab] = useState("token-info");
  const { isMobile } = usePlatform();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("buy");
  const statusNum = Number(seasonDetailsQuery?.data?.status);
  const isActiveSeason = statusNum === 1;
  const isCompletedSeason = statusNum === 4 || statusNum === 5;
  const winnerSummaryQuery = useSeasonWinnerSummary(
    seasonIdNumber,
    seasonDetailsQuery?.data?.status,
  );

  // ── Season gating ──
  const isSeasonGated = Boolean(seasonDetailsQuery?.data?.config?.gated);
  const {
    isVerified: isGatingVerified,
    verifyPassword,
    verifySignature,
    gates,
    refetch: refetchGating,
  } = useSeasonGating(seasonIdNumber, { isGated: isSeasonGated });

  const pendingGateType = useMemo(() => {
    if (!gates || gates.length === 0) return null;
    return Number(gates[0].gateType);
  }, [gates]);
  const [gateModalOpen, setGateModalOpen] = useState(false);
  // Track which action to resume after password verification
  const [pendingAction, setPendingAction] = useState(null); // "buy" | "sell" | null

  const nowSec = Math.floor(Date.now() / 1000);
  const startTimeSec = seasonDetailsQuery?.data?.config?.startTime
    ? Number(seasonDetailsQuery.data.config.startTime)
    : null;
  const isPreStartSeason =
    startTimeSec !== null && Number.isFinite(startTimeSec)
      ? nowSec < startTimeSec
      : false;

  const {
    curveSupply,
    curveReserves,
    curveStep,
    /* bondStepsPreview, */ allBondSteps,
    debouncedRefresh,
  } = useCurveState(bondingCurveAddress, {
    isActive: isActiveSeason,
    pollMs: 12000,
    enabled: isActiveSeason || isPreStartSeason,
    includeSteps: !isCompletedSeason,
    includeFees: !isCompletedSeason,
  });
  // removed inline estimator state used by old form
  // helpers now imported from lib/curveMath

  // Connected wallet (needed for desktop position display guard)
  const { isConnected, address: connectedAddress } = useAccount();

  // Player position via extracted hook (handles wallet reads + ERC20 fallback)
  const {
    position: localPosition,
    isRefreshing,
    setIsRefreshing,
    setPosition: setLocalPosition,
    refreshNow: refreshPositionNow,
  } = usePlayerPosition(bondingCurveAddress, {
    seasonDetails: seasonDetailsQuery?.data,
  });

  const [lastPositionRefreshAt, setLastPositionRefreshAt] = useState(0);

  // Subscribe to on-chain PositionUpdate events to refresh immediately
  useCurveEvents(bondingCurveAddress, {
    onPositionUpdate: () => {
      if (!isActiveSeason) return;
      debouncedRefresh(0);
      const now = Date.now();
      if (now - lastPositionRefreshAt < 1200) return;
      setLastPositionRefreshAt(now);
      refreshPositionNow();
    },
  });

  // Staggered refresh: immediate + 1.5 s + 4 s to handle indexer lag
  const triggerStaggeredRefresh = useStaggeredRefresh(
    [() => debouncedRefresh(0), refreshPositionNow],
    {
      onStart: () => setIsRefreshing(true),
      onEnd: () => setIsRefreshing(false),
    },
  );

  // Toasts state for tx updates (component scope)
  const [toasts, setToasts] = useState([]);
  const netKeyOuter = getStoredNetworkKey();
  const netOuter = getNetworkByKey(netKeyOuter);
  const addToast = ({ type = "success", message, hash }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url =
      hash && netOuter?.explorer
        ? `${netOuter.explorer.replace(/\/$/, "")}/tx/${hash}`
        : undefined;
    setToasts((t) => [{ id, type, message, hash, url }, ...t]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 120000); // 2 minutes
  };

  // Live pricing rendered via InfoFiPricingTicker component (SSE)

  // removed old inline SOF formatter; TokenInfoTab handles formatting where needed

  // chainNow is provided by useChainTime() hook (shared React Query cache)

  // removed old inline buy/sell handlers (now in BuySellWidget)

  // Removed old sell estimate effect; BuySellWidget handles quoting and submission.

  // debouncedRefresh is triggered by BuySellWidget via onTxSuccess

  // removed estimator side-effects for old form

  // simulators now unused

  // Mobile view handlers
  const handleBuy = () => {
    // Block if season data not loaded yet
    if (!seasonDetailsQuery?.data || seasonDetailsQuery.isLoading) {
      return;
    }
    
    if (chainNow != null) {
      const startTs = Number(seasonDetailsQuery.data.config?.startTime || 0);
      if (Number.isFinite(startTs) && chainNow < startTs) {
        return;
      }
    }
    
    // Check gating from loaded season data (not derived state)
    const seasonGated = Boolean(seasonDetailsQuery.data.config?.gated);
    
    if (seasonGated && isGatingVerified !== true) {
      setPendingAction("buy");
      setGateModalOpen(true);
      return;
    }
    
    setSheetMode("buy");
    setSheetOpen(true);
  };

  const handleSell = async () => {
    // Block if season data not loaded yet
    if (!seasonDetailsQuery?.data || seasonDetailsQuery.isLoading) {
      return;
    }
    
    if (chainNow != null) {
      const startTs = Number(seasonDetailsQuery.data.config?.startTime || 0);
      if (Number.isFinite(startTs) && chainNow < startTs) return;
    }
    
    // Check gating from loaded season data (not derived state)
    const seasonGated = Boolean(seasonDetailsQuery.data.config?.gated);
    if (seasonGated && isGatingVerified !== true) {
      setPendingAction("sell");
      setGateModalOpen(true);
      return;
    }
    // Refresh position before opening sell sheet to get latest ticket count
    await refreshPositionNow();

    // Force a delay and check if position was actually updated
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Additional delay to ensure React processes all state updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    setSheetMode("sell");

    // Additional delay to ensure React processes all state updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    setSheetOpen(true);
  };

  // Called after successful password verification
  const handleGateVerified = async () => {
    // Wait for gating status to be refetched and cache updated
    await refetchGating();
    
    if (pendingAction === "buy") {
      setSheetMode("buy");
      setSheetOpen(true);
    } else if (pendingAction === "sell") {
      await refreshPositionNow();
      await new Promise((resolve) => setTimeout(resolve, 300));
      setSheetMode("sell");
      setSheetOpen(true);
    }
    setPendingAction(null);
  };

  // Mobile view for Farcaster Mini App and Base App
  if (isMobile && seasonDetailsQuery.data?.config) {
    const cfg = seasonDetailsQuery.data.config;
    const totalPrizePool = curveReserves || 0n;
    const maxSupply = (() => {
      try {
        if (cfg?.maxSupply != null) return BigInt(cfg.maxSupply);

        const last =
          Array.isArray(allBondSteps) && allBondSteps.length > 0
            ? allBondSteps[allBondSteps.length - 1]
            : null;

        const candidate = last?.rangeTo ?? last?.cumulativeSupply ?? 0n;
        return BigInt(candidate);
      } catch {
        return 0n;
      }
    })();

    return (
      <>
        <MobileRaffleDetail
          seasonId={seasonIdNumber}
          seasonConfig={cfg}
          status={seasonDetailsQuery.data.status}
          curveSupply={curveSupply}
          maxSupply={maxSupply}
          curveStep={curveStep}
          allBondSteps={allBondSteps}
          localPosition={localPosition}
          totalPrizePool={totalPrizePool}
          onBuy={handleBuy}
          onSell={handleSell}
          isGated={isSeasonGated}
          isVerified={isGatingVerified}
        />
        <BuySellSheet
          key={`position-${localPosition?.tickets?.toString() || "0"}`}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          mode={sheetMode}
          seasonId={seasonIdNumber}
          seasonStatus={seasonDetailsQuery.data.status}
          seasonEndTime={cfg?.endTime}
          bondingCurveAddress={bondingCurveAddress}
          maxSellable={localPosition?.tickets || 0n}
          onSuccess={async () => {
            setSheetOpen(false);
            // Immediate refresh
            await refreshPositionNow();
            // Debounced refresh for curve data
            debouncedRefresh(0);
            // Additional refreshes to catch up with blockchain indexing
            setTimeout(async () => {
              await refreshPositionNow();
              debouncedRefresh(0);
            }, 1000);
            setTimeout(async () => {
              await refreshPositionNow();
              debouncedRefresh(0);
            }, 3000);
          }}
          onNotify={(evt) => {
            // Handle position updates from sheet (don't close sheet)
            if (evt.type === "position_update" && evt.positionData) {
              setLocalPosition(evt.positionData);
              return;
            }

            // Handle other notifications
            addToast(evt);
            setIsRefreshing(true);
            debouncedRefresh(0);
            refreshPositionNow();
          }}
        />
        {pendingGateType === GateType.SIGNATURE ? (
          <SignatureGateModal
            open={gateModalOpen}
            onOpenChange={setGateModalOpen}
            seasonId={seasonIdNumber}
            seasonName={cfg?.name || ""}
            userAddress={connectedAddress}
            verifySignature={verifySignature}
            onVerified={handleGateVerified}
          />
        ) : (
          <PasswordGateModal
            open={gateModalOpen}
            onOpenChange={setGateModalOpen}
            seasonName={cfg?.name || ""}
            onVerify={verifyPassword}
            onVerified={handleGateVerified}
          />
        )}
      </>
    );
  }

  // Desktop view
  return (
    <div>
      {seasonDetailsQuery.isLoading && <p>Loading season details...</p>}
      {seasonDetailsQuery.error && (
        <p>Error: {seasonDetailsQuery.error.message}</p>
      )}
      {seasonDetailsQuery.data &&
        seasonDetailsQuery.data.config &&
        (() => {
          const cfg = seasonDetailsQuery.data.config;
          const start = Number(cfg?.startTime || 0);
          const end = Number(cfg?.endTime || 0);
          const bc = cfg?.bondingCurve;
          const isZeroAddr = typeof bc === "string" && /^0x0{40}$/i.test(bc);
          const isValid = start > 0 && end > 0 && bc && !isZeroAddr;

          if (!isValid) {
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Season #{seasonId}</CardTitle>
                  <CardDescription>
                    Detailed view of the raffle season.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Season not found or not initialized.
                  </p>
                </CardContent>
              </Card>
            );
          }

          return (
            <>
              <PageTitle
                title={
                  <>
                    {t("season")} #{seasonId} - {cfg.name}
                  </>
                }
              />

              <div className="px-6 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  {t("start")}: {formatTimestamp(cfg.startTime)}
                </span>
                <span>
                  {t("end")}: {formatTimestamp(cfg.endTime)}
                </span>
                {(() => {
                  if (!chainNow) return null;
                  const startTs = Number(cfg.startTime);
                  const endTs = Number(cfg.endTime);
                  const preStart = Number.isFinite(startTs)
                    ? chainNow < startTs
                    : false;
                  const activeWindow =
                    statusNum === 1 &&
                    Number.isFinite(startTs) &&
                    Number.isFinite(endTs)
                      ? chainNow >= startTs && chainNow < endTs
                      : false;

                  if (preStart) {
                    return (
                      <span className="flex items-center gap-1">
                        <span className="text-primary">
                          {t("startsIn", {
                            defaultValue: "Raffle starts in",
                          })}
                          :
                        </span>
                        <CountdownTimer
                          targetTimestamp={startTs}
                          compact
                          className="text-foreground"
                        />
                      </span>
                    );
                  }

                  if (activeWindow) {
                    return (
                      <span className="flex items-center gap-1">
                        <span className="text-primary">{t("endsIn")}:</span>
                        <CountdownTimer
                          targetTimestamp={endTs}
                          compact
                          className="text-foreground"
                        />
                      </span>
                    );
                  }

                  return null;
                })()}
              </div>

              {(() => {
                const startTs = Number(cfg.startTime);
                const endTs = Number(cfg.endTime);
                if (!chainNow) return null;

                // Reason: these hints are only intended for admin-controlled transitions.
                if (
                  statusNum === 0 &&
                  chainNow >= startTs &&
                  chainNow < endTs
                ) {
                  return (
                    <p className="px-6 text-sm text-muted-foreground">
                      Window open on-chain, awaiting admin Start.
                    </p>
                  );
                }

                if (chainNow >= endTs && statusNum === 1) {
                  return (
                    <p className="px-6 text-sm text-muted-foreground">
                      Window ended on-chain, awaiting admin End.
                    </p>
                  );
                }

                return null;
              })()}

              {isCompletedSeason && winnerSummaryQuery.data && (
                <div className="px-6 mt-3">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm font-semibold text-foreground">
                        {t("winnerAnnouncement")}
                      </div>
                      <div className="mt-2 text-sm uppercase tracking-wide text-primary">
                        {t("winner")}:
                      </div>
                      <div className="text-lg font-semibold text-foreground mt-1">
                        <UsernameDisplay
                          address={winnerSummaryQuery.data.winnerAddress}
                          className="text-lg"
                        />
                      </div>
                      <div className="text-sm text-muted-foreground mt-2">
                        {t("grandPrize")}:{" "}
                        {(() => {
                          try {
                            return `${Number(formatUnits(winnerSummaryQuery.data.grandPrizeWei, 18)).toFixed(2)} SOF`;
                          } catch {
                            return "0.00 SOF";
                          }
                        })()}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Sponsored Prizes Display */}
              <div className="px-6 mt-3">
                <SponsoredPrizesDisplay seasonId={seasonId} isCompleted={isCompletedSeason} />
              </div>

              {/* Sponsor Prize Widget (for active seasons) */}
              {!isCompletedSeason && statusNum >= 1 && (
                <div className="px-6 mt-3">
                  <SponsorPrizeWidget seasonId={seasonId} />
                </div>
              )}

              {/* Claim Prize Widget (for winners) */}
              {isCompletedSeason && (
                <div className="px-6 mt-3 flex justify-center">
                  <ClaimPrizeWidget seasonId={seasonId} />
                </div>
              )}

              {/* Bonding Curve UI */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
                {(() => {
                  if (!chainNow) return null;

                  return (
                    <Card className="lg:col-span-2">
                      <CardHeader>
                        <CardTitle>Bonding Curve</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <BondingCurvePanel
                          curveSupply={curveSupply}
                          curveStep={curveStep}
                          allBondSteps={allBondSteps}
                        />
                        {curveStep?.rangeTo != null && curveSupply != null && (() => {
                          const remaining = BigInt(curveStep.rangeTo) - BigInt(curveSupply);
                          if (remaining <= 0n) return null;
                          return (
                            <div className="flex justify-center mt-3">
                              <div className="w-3/5 text-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                                <span className="font-mono font-semibold text-foreground">{remaining.toString()}</span>{" "}
                                {t("ticketsRemainUntilNextPriceIncrease", { defaultValue: "tickets remain until next price increase" })}
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  );
                })()}
                <Card>
                  <CardContent>
                    {chainNow && (
                      <BuySellWidget
                        bondingCurveAddress={bc}
                        seasonId={seasonIdNumber}
                        initialTab={initialTradeTab}
                        isGated={isSeasonGated}
                        isVerified={isGatingVerified}
                        onGatingRequired={(mode) => {
                          setPendingAction(mode);
                          setGateModalOpen(true);
                        }}
                        onTxSuccess={() => triggerStaggeredRefresh()}
                        onNotify={(evt) => {
                          addToast(evt);
                          triggerStaggeredRefresh();
                        }}
                      />
                    )}
                    {/* Player position display - only visible when a wallet is connected */}
                    {isConnected && (
                      <SecondaryCard
                        title={t("yourCurrentPosition")}
                        right={
                          isRefreshing ? (
                            <Badge variant="outline" className="animate-pulse">
                              {t("updating")}
                            </Badge>
                          ) : null
                        }
                      >
                        {localPosition ? (
                          <div className="space-y-1">
                            <div>
                              <span className="text-primary">
                                {t("tickets")}:
                              </span>{" "}
                              <span className="font-mono">
                                {localPosition.tickets.toString()}
                              </span>
                            </div>
                            <div>
                              <span className="text-primary">
                                {t("winProbability")}:
                              </span>{" "}
                              <span className="font-mono">
                                {(() => {
                                  try {
                                    const bps = Number(localPosition.probBps);
                                    return `${(bps / 100).toFixed(2)}%`;
                                  } catch {
                                    return "0.00%";
                                  }
                                })()}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("totalTicketsAtSnapshot")}:{" "}
                              <span className="font-mono">
                                {localPosition.total.toString()}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            No position yet.
                          </span>
                        )}
                      </SecondaryCard>
                    )}
                    {/* Toasts container (inline under position) */}
                    {toasts.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {toasts.map((toast) => (
                          <Alert
                            key={toast.id}
                            variant={toast.type === "error" ? "destructive" : "success"}
                          >
                            <AlertTitle>{toast.message}</AlertTitle>
                            {toast.hash && (
                              <AlertDescription>
                                <ExplorerLink
                                  value={toast.hash}
                                  type="tx"
                                  text="View Transaction"
                                  className="underline text-primary font-mono break-all"
                                />
                              </AlertDescription>
                            )}
                          </Alert>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>{t("activityAndDetails")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                      <TabsTrigger value="token-info">
                        {t("tokenInfo")}
                      </TabsTrigger>
                      <TabsTrigger value="transactions">
                        {t("common:transactions")}
                      </TabsTrigger>
                      <TabsTrigger value="holders">
                        {t("tokenHolders")}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="token-info">
                      <TokenInfoTab
                        bondingCurveAddress={bc}
                        seasonId={seasonIdNumber}
                        curveSupply={curveSupply}
                        allBondSteps={allBondSteps}
                        curveReserves={curveReserves}
                        seasonStatus={seasonDetailsQuery.data.status}
                        totalPrizePool={seasonDetailsQuery.data.totalPrizePool}
                      />
                    </TabsContent>
                    <TabsContent value="transactions">
                      <TransactionsTab
                        bondingCurveAddress={bc}
                        seasonId={seasonIdNumber}
                      />
                    </TabsContent>
                    <TabsContent value="holders">
                      <HoldersTab
                        bondingCurveAddress={bc}
                        seasonId={seasonIdNumber}
                      />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
              <RaffleAdminControls seasonId={seasonIdNumber} />
              <TreasuryControls
                seasonId={seasonIdNumber}
                bondingCurveAddress={bc}
              />
            </>
          );
        })()}
      {pendingGateType === GateType.SIGNATURE ? (
        <SignatureGateModal
          open={gateModalOpen}
          onOpenChange={setGateModalOpen}
          seasonId={seasonIdNumber}
          seasonName={seasonDetailsQuery?.data?.config?.name || ""}
          userAddress={connectedAddress}
          verifySignature={verifySignature}
          onVerified={handleGateVerified}
        />
      ) : (
        <PasswordGateModal
          open={gateModalOpen}
          onOpenChange={setGateModalOpen}
          seasonName={seasonDetailsQuery?.data?.config?.name || ""}
          onVerify={verifyPassword}
          onVerified={handleGateVerified}
        />
      )}
    </div>
  );
};

export default RaffleDetails;
