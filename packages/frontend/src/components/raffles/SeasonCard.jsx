import PropTypes from "prop-types";
import { useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatUnits } from "viem";
import { useCurveState } from "@/hooks/useCurveState";
import { useTradingLockStatus } from "@/hooks/buysell";
import { buildPublicClient } from "@/lib/viemClient";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import BondingCurvePanel from "@/components/curve/CurveGraph";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CountdownTimer from "@/components/common/CountdownTimer";
import TimeElapsed from "@/components/common/TimeElapsed";
import UsernameDisplay from "@/components/user/UsernameDisplay";

const SeasonCard = ({ season, renderBadge, winnerSummary }) => {
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
  // Precise per-status gates (replaces the previous coarse
  // isCompleted = (4 || 5) which leaked the curve+price into Settling
  // statuses 2/3/4).
  const isUpcoming = statusNum === 0;
  const isActive = statusNum === 1;
  const isSettling = statusNum === 2 || statusNum === 3 || statusNum === 4;
  const isComplete = statusNum === 5 || statusNum === 6;
  const settlingLabelKey =
    statusNum === 2
      ? "settlingAwaitingEnd"
      : statusNum === 3
        ? "settlingDrawingWinner"
        : statusNum === 4
          ? "settlingDistributing"
          : null;
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
        {/* Active: live curve + current price + buy/sell. Buy/Sell still
            gated by `tradingOpen` (Task 1 — hides buttons once endTime
            passes or the curve is locked, even if status hasn't flipped). */}
        {isActive && (
          <>
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
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="text-xs text-primary">{t("currentPrice")}</div>
                <div className="font-mono text-base">
                  {currentPriceLabel} SOF
                </div>
              </div>
              {tradingOpen && (
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
          </>
        )}

        {/* Upcoming: preview the configured curve + starting price; no
            buy/sell yet. */}
        {isUpcoming && (
          <>
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
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="text-xs text-primary">
                  {t("startingPrice", {
                    defaultValue: "Starting Price (SOF)",
                  })}
                </div>
                <div className="font-mono text-base">
                  {currentPriceLabel} SOF
                </div>
              </div>
            </div>
          </>
        )}

        {/* Settling (2/3/4): trading is locked. Hide curve + price + buy/sell.
            v1 uses endTime as the lock-time proxy for TimeElapsed (spec
            accepted vs. reading vrfRequestTimestamp). */}
        {isSettling && (
          <div className="rounded-md border border-border bg-muted/40 p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("tradingLocked", { defaultValue: "Trading locked" })}
            </div>
            <div className="font-mono text-base text-foreground mt-1">
              <TimeElapsed targetTimestamp={Number(season?.config?.endTime)} />
            </div>
            {settlingLabelKey && (
              <div className="mt-2 text-xs text-muted-foreground">
                {t(settlingLabelKey)}
              </div>
            )}
          </div>
        )}

        {/* Complete (5/6): winner box or no-participants note. */}
        {isComplete && winnerSummary && (
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
        {isComplete && !winnerSummary && totalTickets === 0n && (
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

SeasonCard.propTypes = {
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

export { SeasonCard };
