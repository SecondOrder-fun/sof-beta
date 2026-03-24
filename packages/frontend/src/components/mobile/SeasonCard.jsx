/**
 * Season Card
 * Carousel card for season display in list view - uses existing Card component
 */

import PropTypes from "prop-types";
import { formatUnits } from "viem";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Lock } from "lucide-react";
import { CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ContentBox, ImportantBox } from "@/components/ui/content-box";
import MiniCurveChart from "@/components/curve/MiniCurveChart";
import CountdownTimer from "@/components/common/CountdownTimer";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import { useSeasonWinnerSummary } from "@/hooks/useSeasonWinnerSummaries";
import { useCurveState } from "@/hooks/useCurveState";
import { useMemo } from "react";

const FarcasterIcon = ({ className }) => (
  <svg viewBox="0 0 1000 1000" className={className} fill="currentColor">
    <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
    <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
    <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
  </svg>
);

FarcasterIcon.propTypes = { className: PropTypes.string };

const EthereumIcon = ({ className }) => (
  <svg viewBox="0 0 256 417" className={className} fill="currentColor">
    <path d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" opacity=".6" />
    <path d="M127.962 0L0 212.32l127.962 75.639V154.158z" />
    <path d="M127.961 312.187l-1.575 1.92V414.45l1.575 4.6L256 236.587z" opacity=".6" />
    <path d="M127.962 419.05V312.187L0 236.587z" />
  </svg>
);

EthereumIcon.propTypes = { className: PropTypes.string };

export const SeasonCard = ({
  seasonId,
  seasonConfig,
  status,
  curveStep,
  allBondSteps,
  curveSupply,
  onBuy,
  onSell,
  onClick,
  isVerified,
  isGated,
  onVerify,
  isConnected,
  onConnect,
  isFarcaster,
}) => {
  const { t } = useTranslation(["raffle", "common"]);
  const statusNum = Number(status);
  const isCompleted = statusNum === 4 || statusNum === 5;
  const isActiveSeason = statusNum === 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const startTimeSec = seasonConfig?.startTime
    ? Number(seasonConfig.startTime)
    : null;
  const isPreStart =
    startTimeSec !== null && Number.isFinite(startTimeSec)
      ? nowSec < startTimeSec
      : false;
  const seasonEndedByTime = useMemo(() => {
    if (!seasonConfig?.endTime) return false;
    const end = Number(seasonConfig.endTime);
    if (!Number.isFinite(end)) return false;
    return nowSec >= end;
  }, [nowSec, seasonConfig?.endTime]);
  const isSeasonEnded = isCompleted || seasonEndedByTime;
  const winnerSummaryQuery = useSeasonWinnerSummary(seasonId, status);
  const curveState = useCurveState(seasonConfig?.bondingCurve, {
    isActive: isActiveSeason,
    enabled: isActiveSeason || isPreStart,
    pollMs: 15000,
    includeFees: false,
  });
  const displayCurveSupply = curveState.curveSupply ?? curveSupply;
  const displayCurveStep = curveState.curveStep ?? curveStep;
  const displayBondSteps =
    (curveState.allBondSteps && curveState.allBondSteps.length > 0
      ? curveState.allBondSteps
      : allBondSteps) || [];

  const formatSOF = (value) => {
    if (!value) return "0";
    const num = Number(formatUnits(BigInt(value || 0), 18));
    return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
  };

  const grandPrize = useMemo(() => {
    try {
      const reserves = curveState.curveReserves ?? 0n;
      return (reserves * 6500n) / 10000n;
    } catch {
      return 0n;
    }
  }, [curveState.curveReserves]);

  return (
    <div
      onClick={onClick}
      className="cursor-pointer max-w-sm mx-auto h-full flex flex-col"
    >
      <CardHeader className="py-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-primary shrink-0">
            Season #{seasonId}
          </span>
          <span className="font-medium text-foreground truncate">{seasonConfig?.name}</span>
          {isGated && isVerified === true && (
            <ShieldCheck className="w-4 h-4 text-green-500 shrink-0 ml-auto" />
          )}
          {isGated && isVerified !== true && (
            <Lock className="w-4 h-4 text-primary shrink-0 ml-auto" />
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0 flex-1 min-h-0">
        {/* Mini Curve Graph — shown for active AND pre-start */}
        {!isSeasonEnded && (
          <>
            <div
              className="bg-muted/40 overflow-hidden flex-1 min-h-0 border border-primary rounded-lg outline-none [&_*]:outline-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
              onClick={(e) => e.stopPropagation()}
            >
              <MiniCurveChart
                curveSupply={displayCurveSupply}
                allBondSteps={displayBondSteps}
                currentStep={displayCurveStep}
              />
            </div>

            {/* Grand Prize — only for active seasons */}
            {!isPreStart && (
              <ImportantBox className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-primary-foreground/80 uppercase tracking-wide">
                  {t("raffle:grandPrize")}
                </span>
                <span className="font-bold text-primary-foreground">
                  {formatSOF(grandPrize)} $SOF
                </span>
              </ImportantBox>
            )}

            {/* Pre-start: "This raffle hasn't started yet" */}
            {isPreStart && (
              <ImportantBox className="flex items-center justify-center px-3 py-2">
                <span className="text-sm text-primary-foreground font-semibold">
                  {t("raffle:raffleNotStarted", { defaultValue: "This raffle hasn't started yet" })}
                </span>
              </ImportantBox>
            )}

            {/* Price + Countdown — same row */}
            <div className="flex gap-2">
              <ContentBox style={{ flex: "35" }}>
                <div className="text-xs text-muted-foreground mb-1">
                  {isPreStart
                    ? t("raffle:startingPrice", { defaultValue: "Starting Price (SOF)" })
                    : t("raffle:currentPrice")}
                </div>
                <div className="font-mono text-base">
                  {formatSOF(displayCurveStep?.price)} SOF
                </div>
              </ContentBox>

              {isPreStart && startTimeSec !== null && (
                <ImportantBox style={{ flex: "65" }}>
                  <div className="text-xs text-primary-foreground/80 mb-1">
                    {t("raffle:startsIn", { defaultValue: "Starts in" })}
                  </div>
                  <CountdownTimer
                    targetTimestamp={startTimeSec}
                    compact
                    className="text-primary-foreground font-bold text-base"
                  />
                </ImportantBox>
              )}

              {!isPreStart && seasonConfig?.endTime && (
                <ImportantBox style={{ flex: "65" }}>
                  <div className="text-xs text-primary-foreground/80 mb-1">
                    {t("raffle:endsIn")}
                  </div>
                  <CountdownTimer
                    targetTimestamp={Number(seasonConfig.endTime)}
                    compact
                    className="text-primary-foreground font-bold text-base"
                  />
                </ImportantBox>
              )}
            </div>
            <Separator />
          </>
        )}

        {isSeasonEnded && !isCompleted && (
          <ImportantBox className="p-4 text-center">
            <div className="text-primary-foreground font-bold text-lg">
              {t("common:tradingLocked", { defaultValue: "Trading is Locked" })}
            </div>
            <div className="text-primary-foreground/80 text-sm mt-1">
              {t("raffle:raffleEnded")}
            </div>
          </ImportantBox>
        )}

        {isCompleted && winnerSummaryQuery.data && (
          <ContentBox className="p-4">
            <div className="text-sm uppercase tracking-wide text-primary">
              {t("raffle:winner")}
            </div>
            <div className="text-lg font-semibold text-foreground mt-1">
              <UsernameDisplay
                address={winnerSummaryQuery.data.winnerAddress}
                className="text-lg"
              />
            </div>
            <div className="text-sm text-muted-foreground mt-2">
              {t("raffle:grandPrize")}:{" "}
              {(() => {
                try {
                  return `${Number(formatUnits(winnerSummaryQuery.data.grandPrizeWei, 18)).toFixed(2)} SOF`;
                } catch {
                  return "0.00 SOF";
                }
              })()}
            </div>
          </ContentBox>
        )}

        {isCompleted &&
          !winnerSummaryQuery.data &&
          BigInt(displayCurveSupply ?? 0n) === 0n && (
            <ContentBox className="p-4">
              <div className="text-sm font-semibold text-foreground">
                {t("raffle:noWinner")}
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                {t("raffle:noParticipants")}
              </div>
            </ContentBox>
          )}

        {/* Action Buttons */}
        {!isSeasonEnded && !isPreStart && !isConnected && (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onConnect?.();
            }}
            variant={isFarcaster ? "farcaster" : "default"}
            size="sm"
            className="w-full"
          >
            {isFarcaster ? (
              <FarcasterIcon className="w-4 h-4 mr-1.5" />
            ) : (
              <EthereumIcon className="w-4 h-4 mr-1.5" />
            )}
            {t("common:connect", { defaultValue: "CONNECT" })}
          </Button>
        )}
        {!isSeasonEnded && !isPreStart && isConnected && isGated && isVerified !== true && (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onVerify?.();
            }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <Lock className="w-3.5 h-3.5 mr-1.5" />
            {t("common:verify", { defaultValue: "VERIFY" })}
          </Button>
        )}
        {!isSeasonEnded && !isPreStart && isConnected && (!isGated || isVerified === true) && (
          <div className="flex gap-2">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onBuy?.();
              }}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              BUY
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onSell?.();
              }}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              SELL
            </Button>
          </div>
        )}
      </CardContent>
    </div>
  );
};

SeasonCard.propTypes = {
  seasonId: PropTypes.number.isRequired,
  seasonConfig: PropTypes.object,
  status: PropTypes.number,
  curveStep: PropTypes.object,
  allBondSteps: PropTypes.array,
  curveSupply: PropTypes.bigint,
  onBuy: PropTypes.func,
  onSell: PropTypes.func,
  onClick: PropTypes.func,
  isVerified: PropTypes.bool,
  isGated: PropTypes.bool,
  onVerify: PropTypes.func,
  isConnected: PropTypes.bool,
  onConnect: PropTypes.func,
  isFarcaster: PropTypes.bool,
};

export default SeasonCard;
