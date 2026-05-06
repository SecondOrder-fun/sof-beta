import PropTypes from "prop-types";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatUnits, createPublicClient, http } from "viem";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { useSeasonWinnerSummaries } from "@/hooks/useSeasonWinnerSummaries";
import { useCurveState } from "@/hooks/useCurveState";
import { useTradingLockStatus } from "@/hooks/buysell";
import { buildPublicClient } from "@/lib/viemClient";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { useAccount, useChains } from "wagmi";
import { useLoginModal } from "@/hooks/useLoginModal";
import BondingCurvePanel from "@/components/curve/CurveGraph";
import { SOFBondingCurveAbi } from "@/utils/abis";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import CountdownTimer from "@/components/common/CountdownTimer";
import { usePlatform } from "@/hooks/usePlatform";
import MobileRafflesList from "@/components/mobile/MobileRafflesList";
import SeasonCardSkeleton from "@/components/common/skeletons/SeasonCardSkeleton";
import { useState, useCallback, useMemo } from "react";
import BuySellSheet from "@/components/mobile/BuySellSheet";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import { useSeasonGating, GateType } from "@/hooks/useSeasonGating";
import PasswordGateModal from "@/components/gating/PasswordGateModal";
import SignatureGateModal from "@/components/gating/SignatureGateModal";
import { useProfileData } from "@/hooks/useProfileData";

const ActiveSeasonCard = ({ season, renderBadge, winnerSummary }) => {
  const navigate = useNavigate();
  const { t } = useTranslation(["raffle", "common"]);
  const bondingCurveAddress = season?.config?.bondingCurve;
  const statusNum = Number(season?.status);
  const isActiveSeason = statusNum === 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const startTimeSec = season?.config?.startTime
    ? Number(season.config.startTime)
    : null;
  const isPreStart =
    startTimeSec !== null && Number.isFinite(startTimeSec)
      ? nowSec < startTimeSec
      : false;
  const totalTickets = BigInt(season?.totalTickets ?? 0n);
  const endTime = season?.config?.endTime;
  const isCompleted = statusNum === 4 || statusNum === 5;
  const { curveSupply, curveStep, allBondSteps } = useCurveState(
    bondingCurveAddress,
    {
      // Poll only while the curve can change (active season). For pre-start
      // and completed seasons useCurveState fetches once and stays put — the
      // curve is locked at close time, so the recorded `currentStep` is the
      // last price tier hit before lock.
      isActive: isActiveSeason,
      pollMs: 15000,
      enabled: true,
    },
  );

  // Mirror BuySellWidget's trading-lock check so ended-but-not-finalized
  // seasons (status 2 or 3 — past endTime, awaiting VRF / settlement) hide
  // their buy/sell buttons in the list view, just like the Detail view's
  // BuySellWidget hides its inputs when curveConfig.tradingLocked is true.
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const lockStatusClient = useMemo(
    () => (net?.rpcUrl ? buildPublicClient(netKey) : null),
    [net?.rpcUrl, netKey],
  );
  const { tradingLocked } = useTradingLockStatus(
    lockStatusClient,
    bondingCurveAddress,
  );
  // Mirror the mobile SeasonCard's time-based gate: even if the on-chain
  // status is still Active and the curve hasn't been locked yet, hide
  // buttons once the season's endTime has passed (status will flip to
  // Ended on the next requestSeasonEnd call).
  const seasonEndedByTime = useMemo(() => {
    if (!endTime) return false;
    const end = Number(endTime);
    if (!Number.isFinite(end)) return false;
    return nowSec >= end;
  }, [nowSec, endTime]);
  // Hide buy/sell buttons whenever trading isn't open. Buttons require:
  // (a) season is currently Active (status === 1), AND
  // (b) the bonding curve hasn't been locked (post-end / paused / cancelled), AND
  // (c) the season's endTime hasn't passed (status will flip soon, no point starting a buy).
  const tradingOpen = isActiveSeason && !tradingLocked && !seasonEndedByTime;

  const currentPriceLabel = (() => {
    try {
      const raw = curveStep?.price ?? 0n;
      // Reason: Bonding curve prices are in SOF (18 decimals by default). For
      // the list view we use a lightweight formatter; the detailed page uses
      // BondingCurvePanel which reads exact decimals.
      return Number(formatUnits(raw, 18)).toFixed(4);
    } catch {
      return "0.0000";
    }
  })();

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="py-1 pb-0">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/raffles/${season.id}`}
            className="flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
          >
            <span className="font-mono text-sm text-primary">
              #{season.id}
            </span>
            <span className="font-medium truncate">{season.config?.name}</span>
          </Link>
          {renderBadge(season.status)}
        </div>
        {/* Countdown timer */}
        {isPreStart && startTimeSec !== null ? (
          <div className="flex items-center gap-1 text-xs mt-1">
            <span className="text-muted-foreground">
              {t("startsIn", { defaultValue: "Raffle starts in" })}:
            </span>
            <CountdownTimer
              targetTimestamp={startTimeSec}
              className="text-primary"
            />
          </div>
        ) : (
          statusNum === 1 &&
          endTime && (
            <div className="flex items-center gap-1 text-xs mt-1">
              <span className="text-muted-foreground">{t("endsIn")}:</span>
              <CountdownTimer
                targetTimestamp={Number(endTime)}
                className="text-primary"
              />
            </div>
          )
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {/* Bonding curve graph — shown for every state. For completed
            raffles this renders the locked curve state (price/step at the
            moment the season was ended). */}
        <div className="overflow-hidden rounded-md bg-muted/40">
          <div className="h-44">
            <BondingCurvePanel
              curveSupply={curveSupply}
              curveStep={curveStep}
              allBondSteps={allBondSteps}
              mini
            />
          </div>
        </div>

        {/* Price line + buy/sell — label switches by state. Buttons only
            render while trading is actually open (active, not locked, not
            past endTime). */}
        <div className="flex items-center justify-between text-sm">
          <div>
            <div className="text-xs text-primary">
              {isPreStart
                ? t("startingPrice", { defaultValue: "Starting Price (SOF)" })
                : isCompleted
                  ? t("lastPrice", { defaultValue: "Last Price" })
                  : t("currentPrice")}
            </div>
            <div className="font-mono text-base">{currentPriceLabel} SOF</div>
          </div>
          {!isPreStart && tradingOpen && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => navigate(`/raffles/${season.id}?mode=buy`)}
              >
                {t("common:buy")}
              </Button>
              <Button
                size="sm"
                onClick={() => navigate(`/raffles/${season.id}?mode=sell`)}
              >
                {t("common:sell")}
              </Button>
            </div>
          )}
        </div>

        {/* Winner / no-participants card for completed raffles. Shown
            below the graph + last-price line so the user can see both the
            on-curve outcome (graph + last price) and the off-curve outcome
            (winner). */}
        {isCompleted && winnerSummary && (
          <div className="rounded-md border border-border bg-muted/40 p-4 text-base text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm uppercase tracking-wide text-primary">
                {t("winner")}
              </span>
              <span className="text-lg font-semibold text-foreground">
                <UsernameDisplay
                  address={winnerSummary.winnerAddress}
                  className="text-lg"
                />
              </span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {t("grandPrize")}:{" "}
              {(() => {
                try {
                  return `${Number(formatUnits(winnerSummary.grandPrizeWei, 18)).toFixed(2)} SOF`;
                } catch {
                  return "0.00 SOF";
                }
              })()}
            </div>
          </div>
        )}
        {isCompleted && !winnerSummary && totalTickets === 0n && (
          <div className="rounded-md border border-border bg-muted/40 p-4 text-base text-muted-foreground">
            <div className="text-sm font-semibold text-foreground">
              {t("noWinner")}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {t("noParticipants")}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

ActiveSeasonCard.propTypes = {
  season: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    status: PropTypes.number,
    totalTickets: PropTypes.any,
    config: PropTypes.shape({
      name: PropTypes.string,
      bondingCurve: PropTypes.string,
      startTime: PropTypes.any,
      // endTime can be string, number, or BigInt from blockchain
      endTime: PropTypes.any,
    }),
  }).isRequired,
  renderBadge: PropTypes.func.isRequired,
  winnerSummary: PropTypes.shape({
    winnerAddress: PropTypes.string,
    grandPrizeWei: PropTypes.any,
  }),
};

const RaffleList = () => {
  const { t } = useTranslation(["raffle", "navigation"]);
  const { isMobile, isFarcaster } = usePlatform();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { address, isConnected } = useAccount();
  const { chainId } = useAccount();
  const chains = useChains();
  const { openLoginModal } = useLoginModal();
  const allSeasonsQuery = useAllSeasons();
  const winnerSummariesQuery = useSeasonWinnerSummaries(allSeasonsQuery.data);

  // "My Raffles" filter — initialized from ?filter=mine URL param
  const [showMineOnly, setShowMineOnly] = useState(
    searchParams.get("filter") === "mine",
  );
  const { seasonBalancesQuery } = useProfileData(address);
  const ownedSeasonIds = useMemo(() => {
    const ids = new Set();
    if (seasonBalancesQuery.data) {
      for (const s of seasonBalancesQuery.data) {
        ids.add(Number(s.seasonId));
      }
    }
    return ids;
  }, [seasonBalancesQuery.data]);

  const handleToggleMine = useCallback(
    (checked) => {
      setShowMineOnly(checked);
      setSearchParams((prev) => {
        if (checked) {
          prev.set("filter", "mine");
        } else {
          prev.delete("filter");
        }
        return prev;
      });
    },
    [setSearchParams],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("buy");
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [localPosition, setLocalPosition] = useState({
    tickets: 0n,
    probBps: 0,
    total: 0n,
  });
  const [activeSeason, setActiveSeason] = useState(null);
  const [gateModalOpen, setGateModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // "buy" | "sell" | null

  // Gating hook — tracks the carousel-visible season
  const isActiveGated = Boolean(activeSeason?.config?.gated);
  const { isVerified, verifyPassword, verifySignature, gates, refetch: refetchGating } = useSeasonGating(
    activeSeason?.id, { isGated: isActiveGated }
  );

  const pendingGateType = useMemo(() => {
    if (!gates || gates.length === 0) return null;
    return Number(gates[0].gateType);
  }, [gates]);

  const handleActiveSeasonChange = useCallback((season) => {
    setActiveSeason(season);
  }, []);

  const handleConnect = useCallback(() => {
    openLoginModal();
  }, [openLoginModal]);

  const renderBadge = (st) => {
    const statusNum = Number(st);
    const label =
      statusNum === 1 ? "Active" : statusNum === 0 ? "NotStarted" : "Completed";
    const variant =
      statusNum === 1
        ? "statusActive"
        : statusNum === 0
          ? "statusUpcoming"
          : "statusCompleted";
    return <Badge variant={variant}>{label}</Badge>;
  };

  const handleBuy = (seasonId) => {
    const season = allSeasonsQuery.data?.find((s) => s.id === seasonId);
    setSelectedSeason(season);

    // Gating check: if gated and not verified, show password modal
    if (season?.config?.gated && isVerified !== true) {
      setPendingAction("buy");
      setGateModalOpen(true);
      return;
    }

    setSheetMode("buy");
    setSheetOpen(true);
  };

  const handleSell = async (seasonId) => {
    const season = allSeasonsQuery.data?.find((s) => s.id === seasonId);
    setSelectedSeason(season);

    // Gating check: if gated and not verified, show password modal
    if (season?.config?.gated && isVerified !== true) {
      setPendingAction("sell");
      setGateModalOpen(true);
      return;
    }

    await openSellSheet(season);
  };

  // Called from SeasonCard's Verify button (no pending buy/sell action)
  const handleVerify = (seasonId) => {
    const season = allSeasonsQuery.data?.find((s) => s.id === seasonId);
    setSelectedSeason(season);
    setPendingAction(null);
    setGateModalOpen(true);
  };

  // Fetch position and open sell sheet (bypasses gating check)
  const openSellSheet = async (season) => {
    const bondingCurveAddress =
      season?.config?.bondingCurve || season?.bondingCurveAddress;

    if (bondingCurveAddress && chainId) {
      const currentChain = chains.find((chain) => chain.id === chainId);
      if (currentChain?.rpcUrls?.default) {
        const rpcUrl = currentChain.rpcUrls.default.http?.[0];
        if (rpcUrl) {
          const positionClient = createPublicClient({
            chain: currentChain,
            transport: http(rpcUrl),
            blockTag: "latest",
          });
          try {
            const [pt, cfg] = await Promise.all([
              positionClient.readContract({
                address: bondingCurveAddress,
                abi: SOFBondingCurveAbi,
                functionName: "playerTickets",
                args: [address],
              }),
              positionClient.readContract({
                address: bondingCurveAddress,
                abi: SOFBondingCurveAbi,
                functionName: "curveConfig",
                args: [],
              }),
            ]);
            const tickets = BigInt(pt ?? 0n);
            const total = BigInt(cfg?.[0] ?? cfg?.totalSupply ?? 0n);
            const probBps = total > 0n ? Number((tickets * 10000n) / total) : 0;
            setLocalPosition({ tickets, probBps, total });
          } catch {
            // ignore
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    setSheetMode("sell");
    setSheetOpen(true);
  };

  // Called after successful password verification
  const handleGateVerified = async () => {
    await refetchGating();
    if (pendingAction === "buy" && selectedSeason) {
      setSheetMode("buy");
      setSheetOpen(true);
    } else if (pendingAction === "sell" && selectedSeason) {
      await openSellSheet(selectedSeason);
    }
    // If pendingAction is null (standalone verify), just close — badge updates reactively
    setPendingAction(null);
  };

  // Mobile view for Farcaster Mini App and Base App
  const seasonsSorted = [...(allSeasonsQuery.data || [])].sort(
    (a, b) => Number(b.id) - Number(a.id),
  );
  const displayedSeasons =
    showMineOnly && isConnected
      ? seasonsSorted.filter((s) => ownedSeasonIds.has(Number(s.id)))
      : seasonsSorted;

  if (isMobile) {
    // Note: We pass raw season data and let MobileRafflesList handle curve state
    // This avoids calling hooks inside map/filter which violates Rules of Hooks
    return (
      <>
        <MobileRafflesList
          seasons={displayedSeasons}
          isLoading={allSeasonsQuery.isLoading}
          onBuy={handleBuy}
          onSell={handleSell}
          onActiveSeasonChange={handleActiveSeasonChange}
          isVerified={isVerified}
          isGated={isActiveGated}
          onVerify={() => activeSeason && handleVerify(activeSeason.id)}
          isConnected={isConnected}
          onConnect={handleConnect}
          isFarcaster={isFarcaster}
          showMineOnly={showMineOnly}
          onToggleMine={handleToggleMine}
        />
        {selectedSeason && (
          <BuySellSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            mode={sheetMode}
            seasonId={selectedSeason.id}
            seasonStatus={selectedSeason.status}
            seasonEndTime={selectedSeason.config?.endTime}
            bondingCurveAddress={selectedSeason.config?.bondingCurve}
            maxSellable={localPosition?.tickets || 0n}
            onSuccess={async () => {
              setSheetOpen(false);
              navigate(`/raffles/${selectedSeason.id}`);
            }}
          />
        )}
        {pendingGateType === GateType.SIGNATURE ? (
          <SignatureGateModal
            open={gateModalOpen}
            onOpenChange={setGateModalOpen}
            seasonId={selectedSeason?.id || activeSeason?.id}
            seasonName={selectedSeason?.config?.name || activeSeason?.config?.name}
            userAddress={address}
            verifySignature={verifySignature}
            onVerified={handleGateVerified}
          />
        ) : (
          <PasswordGateModal
            open={gateModalOpen}
            onOpenChange={setGateModalOpen}
            seasonName={selectedSeason?.config?.name || activeSeason?.config?.name}
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
      <h1 className="text-2xl font-bold text-foreground mb-4">{t("title")}</h1>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t("allSeasons")}</h2>
            <p className="text-sm text-muted-foreground">{t("allSeasonsDescription")}</p>
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              <Switch
                checked={showMineOnly}
                onCheckedChange={handleToggleMine}
                id="desktop-mine-toggle"
              />
              <label
                htmlFor="desktop-mine-toggle"
                className="text-sm text-muted-foreground cursor-pointer select-none"
              >
                {t("navigation:myRaffles")}
              </label>
            </div>
          )}
        </div>
        {allSeasonsQuery.isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SeasonCardSkeleton key={i} />
            ))}
          </div>
        )}
        {allSeasonsQuery.error && <p>Error loading seasons.</p>}
        {displayedSeasons.length === 0 && !allSeasonsQuery.isLoading && (
          <p>{t("noActiveSeasons")}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayedSeasons.map((season) => (
            <ActiveSeasonCard
              key={season.id}
              season={season}
              renderBadge={renderBadge}
              winnerSummary={winnerSummariesQuery.data?.[season.id]}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default RaffleList;
