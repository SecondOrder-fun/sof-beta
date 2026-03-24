/**
 * Mobile Raffle Detail
 * Mobile-optimized layout using existing Card styling
 */

import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatUnits } from "viem";
import { ArrowLeft, Clock, Lock, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ImportantBox } from "@/components/ui/content-box";
import { Separator } from "@/components/ui/separator";
import CountdownTimer from "@/components/common/CountdownTimer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import { useSeasonWinnerSummary } from "@/hooks/useSeasonWinnerSummaries";

export const MobileRaffleDetail = ({
  seasonId,
  seasonConfig,
  status,
  curveSupply,
  maxSupply,
  curveStep,
  allBondSteps,
  localPosition,
  totalPrizePool,
  onBuy,
  onSell,
  isGated = false,
  isVerified = null,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation(["common", "raffle"]);

  const statusNum = Number(status);
  const isCompleted = statusNum === 4 || statusNum === 5;
  const winnerSummaryQuery = useSeasonWinnerSummary(seasonId, status);

  const formatSOF = (weiAmount) => {
    const num = Number(formatUnits(weiAmount ?? 0n, 18));
    return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
  };

  // Build step markers for Progress — evenly spaced across the bar
  const progressSteps = useMemo(() => {
    const steps = Array.isArray(allBondSteps) ? allBondSteps : [];
    if (steps.length === 0 || !maxSupply || maxSupply === 0n) return [];
    const count = steps.length;
    const stride = count > 20 ? Math.ceil(count / 20) : 1;
    const included = steps.filter((_, idx) => idx % stride === 0 || idx === count - 1);
    const n = included.length;
    return included.map((s, idx) => {
      const pos = n <= 1 ? 0 : (idx / (n - 1)) * 100;
      const rawPrice = Number(formatUnits(s.price ?? 0n, 18));
      const price = (Math.ceil(rawPrice * 10) / 10).toFixed(1);
      const stepNum = s?.step ?? idx;
      return { position: pos, label: `${price} SOF`, sublabel: `Step #${stepNum}` };
    });
  }, [allBondSteps, maxSupply]);

  const grandPrize = useMemo(() => {
    if (winnerSummaryQuery.data?.grandPrizeWei != null) {
      return winnerSummaryQuery.data.grandPrizeWei;
    }
    try {
      const reserves = totalPrizePool ?? 0n;
      const grandPrizeBps = 6500n; // Fallback for pre-distributor seasons
      return (reserves * grandPrizeBps) / 10000n;
    } catch {
      return 0n;
    }
  }, [totalPrizePool, winnerSummaryQuery.data]);

  const consolationPerPlayer = useMemo(() => {
    try {
      const supply = Number(curveSupply ?? 0n);
      if (supply <= 1) return 0n;
      const reserves = totalPrizePool ?? 0n;
      const consolationPool = reserves - grandPrize;
      if (consolationPool <= 0n) return 0n;
      return consolationPool / BigInt(supply - 1);
    } catch {
      return 0n;
    }
  }, [totalPrizePool, curveSupply, grandPrize]);

  const now = Math.floor(Date.now() / 1000);
  const startTimeSec = seasonConfig?.startTime
    ? Number(seasonConfig.startTime)
    : null;
  const endTimeSec = seasonConfig?.endTime
    ? Number(seasonConfig.endTime)
    : null;
  const isPreStart =
    !isCompleted && startTimeSec !== null && Number.isFinite(startTimeSec)
      ? now < startTimeSec
      : false;
  const isActive =
    !isCompleted &&
    statusNum === 1 &&
    startTimeSec !== null &&
    endTimeSec !== null &&
    Number.isFinite(startTimeSec) &&
    Number.isFinite(endTimeSec)
      ? now >= startTimeSec && now < endTimeSec
      : false;

  // Adaptive card height — fill space between breadcrumb and BottomNav
  const [cardHeight, setCardHeight] = useState(null);
  const cardRef = useRef(null);

  const updateHeight = useCallback(() => {
    if (!cardRef.current) return;
    const cardTop = cardRef.current.getBoundingClientRect().top;
    const navEl = document.querySelector("nav.fixed.bottom-0");
    const navHeight = navEl ? navEl.getBoundingClientRect().height : 120;
    const h = window.innerHeight - cardTop - navHeight - 12;
    setCardHeight(h);
  }, []);

  useEffect(() => {
    const timer = setTimeout(updateHeight, 100);
    window.addEventListener("resize", updateHeight);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateHeight);
    };
  }, [updateHeight]);

  return (
    <div className="px-3 pt-1 space-y-3 max-w-screen-sm mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => navigate("/raffles")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground flex-1 min-w-0 truncate">
          {t("raffle:season")} #{seasonId}
        </h1>
        {isGated && (
          isVerified === true ? (
            <div className="shrink-0 flex items-center gap-1.5 text-green-500 text-sm font-medium bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
              <ShieldCheck className="w-4 h-4" />
              {t("raffle:verified", { defaultValue: "Verified" })}
            </div>
          ) : (
            <div className="shrink-0 flex items-center gap-1.5 text-primary text-sm font-medium bg-primary/10 border border-primary/20 rounded-full px-3 py-1">
              <Lock className="w-4 h-4" />
              {t("raffle:passwordRequired", { defaultValue: "Password Required" })}
            </div>
          )
        )}
      </div>

      {/* Main Detail Card */}
      <Card
        ref={cardRef}
        className="flex flex-col overflow-hidden"
        style={cardHeight ? { height: cardHeight } : undefined}
      >
        <CardContent className="p-0 flex flex-col h-full">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Header — name + countdown on same row */}
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold flex-1 min-w-0 truncate">
              {seasonConfig?.name || "Loading..."}
            </h2>
            {isPreStart && startTimeSec !== null && (
              <ImportantBox className="shrink-0 flex items-center gap-1.5 px-3 py-1.5">
                <Clock className="w-3.5 h-3.5" />
                <CountdownTimer
                  targetTimestamp={startTimeSec}
                  compact="clock"
                  className="text-primary-foreground font-bold text-sm"
                />
              </ImportantBox>
            )}
            {!isPreStart && seasonConfig?.endTime && (
              <ImportantBox className="shrink-0 flex items-center gap-1.5 px-3 py-1.5">
                <Clock className="w-3.5 h-3.5" />
                <CountdownTimer
                  targetTimestamp={Number(seasonConfig.endTime)}
                  compact="clock"
                  className="text-primary-foreground font-bold text-sm"
                />
              </ImportantBox>
            )}
          </div>

          {/* Progress Section */}
          <div>
            <Progress
              value={maxSupply > 0n ? Number((curveSupply ?? 0n) * 100n / maxSupply) : 0}
              steps={progressSteps}
              className="h-3"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{(curveSupply ?? 0n).toString()} {t("raffle:sold", { defaultValue: "sold" })}</span>
              <span>{(maxSupply ?? 0n).toString()} {t("raffle:max", { defaultValue: "max" })}</span>
            </div>
            {curveStep?.rangeTo != null && curveSupply != null && (() => {
              const remaining = BigInt(curveStep.rangeTo) - BigInt(curveSupply);
              if (remaining <= 0n) return null;
              return (
                <div className="flex justify-center mt-2">
                  <div className="w-3/5 text-center rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">{remaining.toString()}</span>{" "}
                    {t("raffle:ticketsRemainUntilNextPriceIncrease", { defaultValue: "tickets remain until next price increase" })}
                  </div>
                </div>
              );
            })()}
            <Separator className="mt-3" />
          </div>

          {/* Stats + Grand Prize */}
          <div className="flex gap-3">
            {/* Left stack: Price, Tickets, Win % */}
            <div className="flex flex-col gap-3" style={{ flex: "40" }}>
              <div className="bg-background/40 rounded-lg p-3 border border-border flex-1">
                <div className="text-xs text-muted-foreground mb-1">
                  {isPreStart
                    ? t("raffle:startingPrice", { defaultValue: "Starting Price (SOF)" })
                    : t("raffle:ticketPrice")}
                </div>
                <div className="font-bold text-sm">
                  {formatSOF(curveStep?.price)} $SOF
                </div>
              </div>
              <div className="bg-background/40 rounded-lg p-3 border border-border flex-1">
                <div className="text-xs text-muted-foreground mb-1">
                  {t("raffle:yourTickets")}
                </div>
                <div className="font-bold text-sm">
                  {localPosition?.tickets
                    ? localPosition.tickets.toString()
                    : "0"}
                </div>
              </div>
              <div className="bg-background/40 rounded-lg p-3 border border-border flex-1">
                <div className="text-xs text-muted-foreground mb-1">
                  {t("raffle:winChance", { defaultValue: "Win Chance" })}
                </div>
                <div className="font-bold text-sm">
                  {((localPosition?.probBps || 0) / 100).toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Right: Grand Prize */}
            <div
              className="bg-primary/10 border-2 border-primary rounded-lg p-4 flex flex-col items-center justify-center"
              style={{ flex: "60" }}
            >
              <div className="text-primary text-lg font-semibold mb-1">
                {t("raffle:grandPrize").toUpperCase()}
              </div>
              {(() => {
                const val = formatSOF(grandPrize);
                const long = val.length >= 6;
                return long ? (
                  <div className="text-2xl font-bold leading-tight">
                    <div>{val}</div>
                    <div>$SOF</div>
                  </div>
                ) : (
                  <div className="text-2xl font-bold">
                    {val} $SOF
                  </div>
                );
              })()}
              {consolationPerPlayer > 0n && (
                <>
                  <Separator className="my-2 bg-primary/30" />
                  <div className="text-xs text-muted-foreground text-center">
                    <div>{t("raffle:consolationPrize", { defaultValue: "Consolation Prize" }).toUpperCase()}</div>
                    <div className="font-semibold text-foreground">
                      {formatSOF(consolationPerPlayer)} $SOF / {t("raffle:player", { defaultValue: "player" })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {isCompleted && winnerSummaryQuery.data && (
            <div className="bg-background/40 rounded-lg p-4 border border-border">
              <div className="text-xs text-muted-foreground mb-1">
                {t("raffle:winner")}
              </div>
              <div className="text-sm">
                <UsernameDisplay
                  address={winnerSummaryQuery.data.winnerAddress}
                />
              </div>
            </div>
          )}

          {isCompleted &&
            !winnerSummaryQuery.data &&
            BigInt(curveSupply ?? 0n) === 0n && (
              <div className="bg-background/40 rounded-lg p-4 border border-border">
                <div className="text-sm font-semibold text-foreground">
                  {t("raffle:noWinner")}
                </div>
                <div className="text-sm text-muted-foreground mt-2">
                  {t("raffle:noParticipants")}
                </div>
              </div>
            )}

          </div>{/* end scrollable area */}

          {/* Action Buttons — pinned at bottom */}
          <div className="shrink-0 px-6 pb-6 pt-3">
          {isPreStart ? null : isActive ? (
            isGated && isVerified !== true ? (
              <Button
                onClick={onBuy}
                variant="primary"
                size="lg"
                className="w-full relative"
              >
                <Lock className="w-4 h-4 mr-1.5" />
                {t("raffle:verifyAccess", { defaultValue: "Verify Access" }).toUpperCase()}
              </Button>
            ) : (
              <div className="flex gap-3">
                <Button
                  onClick={onBuy}
                  variant="primary"
                  size="lg"
                  className="flex-1 relative"
                >
                  {t("common:buy").toUpperCase()}
                </Button>
                <Button
                  onClick={onSell}
                  variant="primary"
                  size="lg"
                  className="flex-1 relative"
                >
                  {t("common:sell").toUpperCase()}
                </Button>
              </div>
            )
          ) : (
            <div className="relative">
              <div className="flex gap-3 opacity-30">
                <Button
                  disabled
                  variant="primary"
                  size="lg"
                  className="flex-1"
                >
                  {t("common:buy").toUpperCase()}
                </Button>
                <Button
                  disabled
                  variant="primary"
                  size="lg"
                  className="flex-1"
                >
                  {t("common:sell").toUpperCase()}
                </Button>
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-background/90 border border-primary rounded-lg px-4 py-2">
                  <p className="text-sm font-semibold text-foreground">
                    {t("raffle:raffleEnded")}
                  </p>
                </div>
              </div>
            </div>
          )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

MobileRaffleDetail.propTypes = {
  seasonId: PropTypes.number.isRequired,
  seasonConfig: PropTypes.object,
  status: PropTypes.number,
  curveSupply: PropTypes.bigint,
  maxSupply: PropTypes.bigint,
  curveStep: PropTypes.object,
  allBondSteps: PropTypes.array,
  localPosition: PropTypes.object,
  totalPrizePool: PropTypes.bigint,
  onBuy: PropTypes.func,
  onSell: PropTypes.func,
  isGated: PropTypes.bool,
  isVerified: PropTypes.bool,
};

export default MobileRaffleDetail;
