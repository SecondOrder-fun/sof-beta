// src/components/admin/SeasonList.jsx
import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import TransactionModal from "./TransactionModal";
import { formatTimestamp } from "@/lib/utils";
import { Clock, PlayCircle, CheckCircle2 } from "lucide-react";

// Section header component for grouped seasons
const SectionHeader = ({ icon: Icon, title, count, variant }) => (
  <div className={`flex items-center gap-2 py-2 px-3 rounded-t-lg border-b ${
    variant === "pending" ? "bg-warning/10 border-warning/20" :
    variant === "started" ? "bg-info/10 border-info/20" :
    "bg-success/10 border-success/20"
  }`}>
    <Icon className={`h-5 w-5 ${
      variant === "pending" ? "text-warning" :
      variant === "started" ? "text-info" :
      "text-success"
    }`} />
    <span className="font-semibold">{title}</span>
    <Badge variant="secondary" className="ml-auto">{count}</Badge>
  </div>
);

SectionHeader.propTypes = {
  icon: PropTypes.elementType.isRequired,
  title: PropTypes.string.isRequired,
  count: PropTypes.number.isRequired,
  variant: PropTypes.oneOf(["pending", "started", "closed"]).isRequired,
};

// Season status enum values from contract
const SeasonStatus = {
  NotStarted: 0,
  Active: 1,
  EndRequested: 2,
  VRFPending: 3,
  Distributing: 4,
  Completed: 5,
};

// Categorize seasons into display groups
const getSeasonCategory = (status) => {
  if (status === SeasonStatus.NotStarted) return "pending";
  if (status === SeasonStatus.Completed) return "closed";
  // Active, EndRequested, VRFPending, Distributing all go to "started"
  return "started";
};

const SeasonList = ({
  seasons,
  hasCreatorRole,
  hasEmergencyRole: _hasEmergencyRole,
  chainId,
  networkConfig,
  startSeason,
  requestSeasonEnd,
  fundDistributor,
  verify,
  endingE2EId,
  endStatus,
}) => {
  const { t } = useTranslation("admin");
  const [lastStartSeasonId, setLastStartSeasonId] = useState(null);
  const [lastEndSeasonId, setLastEndSeasonId] = useState(null);

  // Group seasons by category
  const groupedSeasons = useMemo(() => {
    const filtered = (seasons || []).filter((season) => Number(season.id) > 0);
    return {
      pending: filtered.filter((s) => getSeasonCategory(s.status) === "pending"),
      started: filtered.filter((s) => getSeasonCategory(s.status) === "started"),
      closed: filtered.filter((s) => getSeasonCategory(s.status) === "closed"),
    };
  }, [seasons]);

  if (!seasons || seasons.length === 0) {
    return <p>{t("noSeasonsFound")}</p>;
  }

  // Render a single season card
  const renderSeasonCard = (season) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = Number(season.config.startTime);
    const endSec = Number(season.config.endTime);
    const isWindowOpen = nowSec >= startSec && nowSec < endSec;
    const isPastEnd = nowSec >= endSec;
    const isNotStarted = season.status === SeasonStatus.NotStarted;
    const isActive = season.status === SeasonStatus.Active;
    const chainMatch = chainId === networkConfig.id;
    const canStart = isNotStarted && isWindowOpen;
    const canEnd = (isActive && isPastEnd) || (isNotStarted && isPastEnd);
    const startDate = formatTimestamp(season.config.startTime);
    const endDate = formatTimestamp(season.config.endTime);
    const showStartStatus = lastStartSeasonId === season.id;

    // Get detailed status label
    const getStatusLabel = () => {
      switch (season.status) {
        case SeasonStatus.NotStarted: return t("notStarted");
        case SeasonStatus.Active: return t("active");
        case SeasonStatus.EndRequested: return "End Requested";
        case SeasonStatus.VRFPending: return "VRF Pending";
        case SeasonStatus.Distributing: return "Distributing";
        case SeasonStatus.Completed: return t("completed");
        default: return "Unknown";
      }
    };

    return (
      <div
        key={season.id}
        className="flex items-start justify-between gap-4 rounded border p-3 bg-card"
      >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold">
                    Season #{season.id} - {season.config.name}
                  </p>
                  <Badge variant="outline">
                    {getStatusLabel()}
                  </Badge>
                  {isWindowOpen && (
                    <Badge variant="secondary">
                      {t("chainTimeOk")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Start: {startDate} | End: {endDate}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                {!hasCreatorRole && (
                  <p className="text-xs text-warning">
                    {t("missingSeasonCreatorRole")}
                  </p>
                )}

                {isNotStarted && (
                  <Button
                    onClick={() => {
                      setLastStartSeasonId(season.id);
                      startSeason?.mutate?.({ seasonId: season.id });
                    }}
                    disabled={
                      startSeason?.isPending ||
                      !hasCreatorRole ||
                      !canStart ||
                      !chainMatch
                    }
                    size="lg"
                    className="min-w-[100px]"
                  >
                    {t("start")}
                  </Button>
                )}

                {showStartStatus && startSeason?.error && (
                  <p className="max-w-[260px] break-words text-xs text-destructive">
                    {startSeason.error.message}
                  </p>
                )}

                {/* Settle button - consolidates Request End + Fund Distributor */}
                {canEnd && (
                  <Button
                    onClick={() => {
                      setLastEndSeasonId(season.id);
                      // For seasons needing settlement, call requestSeasonEnd which auto-finalizes
                      // If there was a previous error (needs fixing), call fundDistributor instead
                      if (verify[season.id]?.error) {
                        fundDistributor(season.id);
                      } else {
                        requestSeasonEnd?.mutate?.({ seasonId: season.id });
                      }
                    }}
                    disabled={
                      !hasCreatorRole ||
                      !chainMatch ||
                      requestSeasonEnd?.isPending ||
                      endingE2EId === season.id
                    }
                    variant={verify[season.id]?.error ? "destructive" : "secondary"}
                  >
                    {requestSeasonEnd?.isPending && lastEndSeasonId === season.id
                      ? t("settling") || "Settling..."
                      : endingE2EId === season.id
                      ? endStatus || t("working")
                      : verify[season.id]?.error
                      ? t("fixPrizes") || "Fix Prizes"
                      : t("settle") || "Settle"}
                  </Button>
                )}

                {lastEndSeasonId === season.id && requestSeasonEnd?.error && (
                  <p className="max-w-[260px] break-words text-xs text-destructive">
                    {requestSeasonEnd.error.message}
                  </p>
                )}

                {showStartStatus && (
                  <TransactionModal mutation={startSeason} title={`Starting Season #${season.id}`} />
                )}

                {lastEndSeasonId === season.id && (
                  <TransactionModal mutation={requestSeasonEnd} title={`Settling Season #${season.id}`} />
                )}

                {verify[season.id] && (
                  <div className="mt-2 rounded border p-2 text-xs">
                    {verify[season.id].error ? (
                      <p className="text-destructive">{verify[season.id]?.error}</p>
                    ) : (
                      <>
                        {(() => {
                          const v = verify[season.id] || {};
                          const winner =
                            v.distGrandWinnerAfter ||
                            v.distGrandWinner ||
                            v.grandWinner ||
                            "";
                          const funded =
                            v.distFundedAfter ?? v.distFunded ?? v.funded
                              ? "Yes"
                              : "No";
                          // Format token amounts with 4 decimal places
                          const formatToken = (amount) => {
                            if (amount === undefined || amount === null)
                              return "0";
                            const amountBigInt = BigInt(amount);
                            const decimals = 18; // Assuming 18 decimals for SOF token
                            const divisor = 10n ** BigInt(decimals - 4);
                            const formatted = amountBigInt / divisor / 10000n;
                            return formatted.toString();
                          };

                          const grandAmount = v.grandAmount ?? v[2] ?? 0n;
                          const consolationAmount =
                            v.consolationAmount ?? v[3] ?? 0n;

                          return (
                            <>
                              {v.prizeDistributor && (
                                <p>
                                  {t("prizeDistributor")}:{" "}
                                  <span className="font-mono">{`${v.prizeDistributor.slice(
                                    0,
                                    6
                                  )}...${v.prizeDistributor.slice(-4)}`}</span>
                                </p>
                              )}
                              {v.raffleRoleStatus && (
                                <p>
                                  {t("raffleRoleStatus")}: {v.raffleRoleStatus}
                                </p>
                              )}
                              <p>
                                {t("winner")}:{" "}
                                <span className="font-mono">
                                  {winner ===
                                  "0x0000000000000000000000000000000000000000"
                                    ? t("notSet")
                                    : `${winner.slice(0, 6)}...${winner.slice(
                                        -4
                                      )}`}
                                </span>
                              </p>
                              <p>
                                {t("funded")}: {funded}
                              </p>
                              <p>
                                {t("grand")}: {formatToken(grandAmount)} SOF •
                                {t("consolation")}:{" "}
                                {formatToken(consolationAmount)} SOF
                              </p>
                            </>
                          );
                        })()}
                        {verify[season.id]?.requestId != null && (
                          <p>
                            {t("vrfReqId")}:{" "}
                            {String(verify[season.id]?.requestId)}
                          </p>
                        )}
                        {verify[season.id]?.finalizeHash && (
                          <p>
                            {t("finalizeTx")}:{" "}
                            <a
                              className="text-info underline"
                              href={`${networkConfig.explorer}/tx/${
                                verify[season.id].finalizeHash
                              }`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {verify[season.id].finalizeHash.slice(0, 10)}...
                            </a>
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
  };

  return (
    <div className="space-y-6">
      {/* Pending Seasons */}
      {groupedSeasons.pending.length > 0 && (
        <div className="rounded-lg border">
          <SectionHeader
            icon={Clock}
            title={t("pendingSeasons") || "Pending"}
            count={groupedSeasons.pending.length}
            variant="pending"
          />
          <div className="p-2 space-y-2">
            {groupedSeasons.pending.map(renderSeasonCard)}
          </div>
        </div>
      )}

      {/* Started/Active Seasons */}
      {groupedSeasons.started.length > 0 && (
        <div className="rounded-lg border">
          <SectionHeader
            icon={PlayCircle}
            title={t("startedSeasons") || "Started"}
            count={groupedSeasons.started.length}
            variant="started"
          />
          <div className="p-2 space-y-2">
            {groupedSeasons.started.map(renderSeasonCard)}
          </div>
        </div>
      )}

      {/* Closed/Completed Seasons */}
      {groupedSeasons.closed.length > 0 && (
        <div className="rounded-lg border">
          <SectionHeader
            icon={CheckCircle2}
            title={t("closedSeasons") || "Closed"}
            count={groupedSeasons.closed.length}
            variant="closed"
          />
          <div className="p-2 space-y-2">
            {groupedSeasons.closed.map(renderSeasonCard)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {groupedSeasons.pending.length === 0 &&
       groupedSeasons.started.length === 0 &&
       groupedSeasons.closed.length === 0 && (
        <p className="text-center text-muted-foreground py-8">
          {t("noSeasonsFound")}
        </p>
      )}
    </div>
  );
};

SeasonList.propTypes = {
  seasons: PropTypes.array.isRequired,
  hasCreatorRole: PropTypes.bool,
  hasEmergencyRole: PropTypes.bool,
  chainId: PropTypes.number.isRequired,
  networkConfig: PropTypes.object.isRequired,
  startSeason: PropTypes.object.isRequired,
  requestSeasonEnd: PropTypes.object.isRequired,
  fundDistributor: PropTypes.func.isRequired,
  verify: PropTypes.object.isRequired,
  endingE2EId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  endStatus: PropTypes.string,
};

export default SeasonList;
