import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { createPublicClient, http } from "viem";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { useSeasonWinnerSummaries } from "@/hooks/useSeasonWinnerSummaries";
import { useAccount, useChains } from "wagmi";
import { useLoginModal } from "@/hooks/useLoginModal";
import { SOFBondingCurveAbi } from "@/utils/abis";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePlatform } from "@/hooks/usePlatform";
import MobileRafflesList from "@/components/mobile/MobileRafflesList";
import SeasonCardSkeleton from "@/components/common/skeletons/SeasonCardSkeleton";
import { useState, useCallback, useMemo } from "react";
import BuySellSheet from "@/components/mobile/BuySellSheet";
import { useSeasonGating, GateType } from "@/hooks/useSeasonGating";
import PasswordGateModal from "@/components/gating/PasswordGateModal";
import SignatureGateModal from "@/components/gating/SignatureGateModal";
import { useProfileData } from "@/hooks/useProfileData";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { SeasonCard } from "@/components/raffles/SeasonCard";

/**
 * Map an on-chain SeasonStatus enum value to its tab group name.
 * Spec: docs/superpowers/specs/2026-05-10-raffle-list-design-upgrade-design.md
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getSeasonGroup(statusNum) {
  const n = Number(statusNum);
  if (n === 0) return "upcoming";
  if (n === 1) return "active";
  if (n === 2 || n === 3 || n === 4) return "settling";
  if (n === 5 || n === 6) return "complete";
  return "active";
}

const RaffleList = () => {
  const { t } = useTranslation(["raffle", "navigation"]);
  const { isMobile, isFarcaster } = usePlatform();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { address, isConnected } = useAccount();
  const { sma } = useRaffleAccount();
  const { chainId } = useAccount();
  const chains = useChains();
  const { openLoginModal } = useLoginModal();
  const allSeasonsQuery = useAllSeasons();
  const winnerSummariesQuery = useSeasonWinnerSummaries(allSeasonsQuery.data);

  // "My Raffles" filter — initialized from ?filter=mine URL param
  const [showMineOnly, setShowMineOnly] = useState(
    searchParams.get("filter") === "mine",
  );
  // Profile/balance reads resolve at the user's smart account, not the EOA.
  const { seasonBalancesQuery } = useProfileData(sma);
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
                args: [sma],
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
            <SeasonCard
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
