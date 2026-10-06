// src/components/launchpad/RaffleCard.jsx
//
// The raffle priced in a launch token, on that token's page. Leads with the
// season the backend features (live > drawing > upcoming > latest result) and
// renders one of six states:
//
//   live      — prize pool, next ticket price, tickets and players, the ticket
//               price ladder (MiniCurveChart), your tickets, and the primary
//               "Enter raffle" CTA. Pool and tickets come from the live curve
//               state and players from the live participant count: the season
//               summary is only written at start, status changes and
//               completion, so mid-season it reads 0 or stale (it stands in
//               until the live reads arrive)
//   upcoming  — opening time and starting ticket price; CTA disabled
//   drawing   — entries closed, VRF drawing; no CTA
//   ended     — winner and their grand prize — never the whole pool, which
//               also funds consolation; with the split unknown, no amount —
//               (or "cancelled", badged and labelled as such); CTA to open
//               the next season
//   none      — the token has no season yet; CTA to open the first
//   Both CTAs open /create-season?quoteToken=<this token>, so the new season
//   is priced in it.
//   unavailable — the seasons read failed with nothing cached; says so, no CTA
//                 (a failed read is not evidence that there is no raffle)
//
// Composed from existing primitives: Card in a Pastel Rose frame, Badge
// (RaffleBadge), Button, CountdownTimer and MiniCurveChart. The prize pool is
// shown in the token with an equivalent in the launch's quote token (ETH, USDC,
// …) from the pool price — never an oracle's USD.

import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import CountdownTimer from "@/components/common/CountdownTimer";
import MiniCurveChart from "@/components/curve/MiniCurveChart";
import RaffleBadge from "@/components/launchpad/RaffleBadge";
import { useCurveState } from "@/hooks/useCurveState";
import { useLiveParticipantCount } from "@/hooks/useLiveParticipantCount";
import { usePlayerPosition } from "@/hooks/usePlayerPosition";
import { useTokenSeasons } from "@/hooks/useLaunchActivity";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/format";
import { formatQuoteAmount, formatSupply, formatTokenAmount } from "@/lib/launchFormat";
import { tokensToQuote } from "@/lib/v4PoolMath";
import { grandPrizeWei } from "@/lib/prizeMath";

const Frame = ({ tone, label, children }) => (
  <section
    aria-label={label}
    className={cn("rounded-xl border p-1", tone === "rose" ? "border-pastel-rose" : "border-border")}
  >
    <Card>
      <CardContent className="p-5 space-y-4">{children}</CardContent>
    </Card>
  </section>
);

Frame.propTypes = {
  tone: PropTypes.oneOf(["rose", "muted"]).isRequired,
  label: PropTypes.string.isRequired,
  children: PropTypes.node,
};

const Stat = ({ label, children }) => (
  <div className="rounded-lg border bg-muted/40 px-3 py-2 min-w-0">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="font-semibold truncate">{children}</div>
  </div>
);

Stat.propTypes = { label: PropTypes.node.isRequired, children: PropTypes.node };

const seasonTitle = (raffle, t) => raffle.name || t("raffle.season", { id: raffle.seasonId });

/**
 * The step the NEXT ticket sells on, and its price. The curve charges ticket
 * n+1 on the first step whose range ends past the current supply
 * (calculateBuyPrice skips a step once supply >= its rangeTo), while
 * getCurrentStep keeps pointing at a step the supply has exactly filled. So
 * the indexed current step answers only while supply is still inside it; at
 * its boundary, or when it is missing, the ladder decides. Past the last
 * step, the last step.
 * @param {{ step: bigint, price: bigint, rangeTo: bigint } | null} curveStep
 * @param {{ rangeTo: bigint, price: bigint }[]} steps
 * @param {bigint} supply
 * @returns {{ price: bigint, index: number } | null}
 */
const nextTicketStep = (curveStep, steps, supply) => {
  if (curveStep && supply < curveStep.rangeTo) return { price: curveStep.price, index: Number(curveStep.step) };
  if (!steps?.length) return null;
  const i = steps.findIndex((st) => st.rangeTo > supply);
  const index = i === -1 ? steps.length - 1 : i;
  return { price: steps[index].price, index };
};

const LiveRaffle = ({ raffle, symbol, market }) => {
  const { t } = useTranslation("launchpad");
  const navigate = useNavigate();
  const { hasState, curveStep, curveSupply, curveReserves, allBondSteps, isPriceLoading } = useCurveState(
    raffle.bondingCurve,
    { isActive: true },
  );
  const { position } = usePlayerPosition(raffle.bondingCurve);
  const players = useLiveParticipantCount(raffle.seasonId, { initialCount: Number(raffle.participants) });

  // Live curve state over the season summary, which lags a live season. Until
  // the curve state loads, curveSupply is a 0n placeholder, so everything that
  // needs the supply — the stats, the next ticket's step, the ladder's marker —
  // reads ticketsSold, which stands in with the summary's count.
  const prizePool = hasState ? curveReserves : BigInt(raffle.prizePool);
  const ticketsSold = hasState ? curveSupply : BigInt(raffle.tickets);
  const prizeInQuote = tokensToQuote(prizePool, market);
  const myTickets = position?.tickets ?? 0n;
  // Skeleton only while a price read is in flight; a missing curve state (e.g.
  // a 404 from the indexer) falls back to the ladder rather than spinning.
  const next = nextTicketStep(curveStep, allBondSteps, ticketsSold);

  return (
    <Frame tone="rose" label={t("raffle.cardLabel", { state: t("raffle.badgeLive") })}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <RaffleBadge raffle={raffle} />
          <span className="font-semibold">{seasonTitle(raffle, t)}</span>
        </div>
        {raffle.endTime ? (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{t("raffle.endsIn")}</div>
            <CountdownTimer targetTimestamp={raffle.endTime} compact="clock" className="text-sm" />
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">{t("raffle.prizePool")}</div>
        <div className="text-4xl font-semibold tracking-tight text-heading">
          {formatSupply(prizePool)} <span className="text-lg font-medium text-muted-foreground">{symbol}</span>
        </div>
        {prizeInQuote != null && market?.quote ? (
          <div className="text-sm text-muted-foreground">
            {t("raffle.prizeQuote", {
              amount: formatQuoteAmount(prizeInQuote, market.quote.decimals),
              quote: market.quote.symbol,
            })}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label={t("raffle.nextTicket")}>
          {next != null ? (
            t("raffle.ticketPrice", { price: formatTokenAmount(next.price), symbol })
          ) : isPriceLoading ? (
            <Skeleton className="h-5 w-16" />
          ) : (
            "—"
          )}
        </Stat>
        <Stat label={t("raffle.ticketsSold")}>{ticketsSold.toLocaleString()}</Stat>
        <Stat label={t("raffle.players")}>{players.toLocaleString()}</Stat>
      </div>

      {allBondSteps.length > 0 ? (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("raffle.priceRises")}</span>
            {curveStep && next ? (
              // The step the next ticket sells on. The index is 0-based;
              // people count from 1.
              <span>{t("raffle.step", { step: next.index + 1, total: allBondSteps.length })}</span>
            ) : null}
          </div>
          <div className="h-16">
            <MiniCurveChart curveSupply={ticketsSold} allBondSteps={allBondSteps} currentStep={curveStep} />
          </div>
        </div>
      ) : null}

      {myTickets > 0n ? (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("raffle.yourTickets")}</span>
          <span>
            <span className="font-semibold">{myTickets.toLocaleString()}</span>{" "}
            <span className="text-muted-foreground">
              {t("raffle.chance", { pct: ((position?.probBps ?? 0) / 100).toFixed(1) })}
            </span>
          </span>
        </div>
      ) : null}

      {/* useNavigate rather than <Button asChild><Link>: asChild wraps in a span,
          so only the link text would be clickable (see routes/Home.jsx). */}
      <Button type="button" size="lg" className="w-full" onClick={() => navigate(`/raffles/${raffle.seasonId}`)}>
        {t("raffle.enter", { symbol })}
      </Button>
    </Frame>
  );
};

LiveRaffle.propTypes = {
  raffle: PropTypes.object.isRequired,
  symbol: PropTypes.string,
  market: PropTypes.shape({ fdv: PropTypes.any, totalSupplyRaw: PropTypes.any, quote: PropTypes.object }),
};

const UpcomingRaffle = ({ raffle, symbol }) => {
  const { t } = useTranslation("launchpad");
  const { allBondSteps } = useCurveState(raffle.bondingCurve, { includeFees: false });
  const startPrice = allBondSteps[0]?.price;

  return (
    <Frame tone="rose" label={t("raffle.cardLabel", { state: t("raffle.badgeOpensSoon") })}>
      <div className="flex items-center gap-2 flex-wrap">
        <RaffleBadge raffle={raffle} />
        <span className="font-semibold">{seasonTitle(raffle, t)}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {startPrice != null
          ? t("raffle.upcomingBody", { price: formatTokenAmount(startPrice), symbol })
          : t("raffle.upcomingBodyNoPrice")}
      </p>
      <Button type="button" variant="outline" className="w-full" disabled>
        {t("raffle.opensSoonCta")}
      </Button>
    </Frame>
  );
};

UpcomingRaffle.propTypes = { raffle: PropTypes.object.isRequired, symbol: PropTypes.string };

/** Opens /create-season with this token preselected as the season's quote token. */
const OpenSeasonCta = ({ label, token }) => {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => navigate(`/create-season?quoteToken=${token}`)}
    >
      {label}
    </Button>
  );
};

OpenSeasonCta.propTypes = { label: PropTypes.string.isRequired, token: PropTypes.string.isRequired };

const RaffleCard = ({ token, symbol, market }) => {
  const { t } = useTranslation("launchpad");
  const { data, isLoading, isError } = useTokenSeasons(token);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

  // A failed read with nothing cached: say so. Showing "No raffle yet" here
  // would invite opening a season that may already exist.
  if (isError && !data) {
    return (
      <Frame tone="muted" label={t("raffle.cardLabel", { state: t("raffle.unavailableState") })}>
        <p className="text-sm text-muted-foreground">{t("raffle.unavailable")}</p>
      </Frame>
    );
  }

  const raffle = data?.featured ?? null;

  if (!raffle) {
    return (
      <Frame tone="muted" label={t("raffle.cardLabel", { state: t("raffle.badgeNone") })}>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="raffleEnded">{t("raffle.badgeNone")}</Badge>
          <span className="font-semibold">{t("raffle.noneTitle", { symbol })}</span>
        </div>
        <p className="text-sm text-muted-foreground">{t("raffle.noneBody", { symbol })}</p>
        <OpenSeasonCta label={t("raffle.openFirst")} token={token} />
      </Frame>
    );
  }

  if (raffle.state === "live") return <LiveRaffle raffle={raffle} symbol={symbol} market={market} />;
  if (raffle.state === "upcoming") return <UpcomingRaffle raffle={raffle} symbol={symbol} />;

  if (raffle.state === "drawing") {
    return (
      <Frame tone="rose" label={t("raffle.cardLabel", { state: t("raffle.badgeDrawing") })}>
        <div className="flex items-center gap-2 flex-wrap">
          <RaffleBadge raffle={raffle} />
          <span className="font-semibold">{seasonTitle(raffle, t)}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("raffle.drawingBody", { count: Number(raffle.participants) })}
        </p>
      </Frame>
    );
  }

  // ended / cancelled. The winner takes the grand prize, not the pool.
  const grandPrize = grandPrizeWei(raffle);
  const title =
    raffle.state === "cancelled"
      ? t("raffle.cancelledTitle", { season: seasonTitle(raffle, t) })
      : raffle.winner
        ? grandPrize != null
          ? t("raffle.wonTitle", { who: shortAddress(raffle.winner), prize: formatSupply(grandPrize), symbol })
          : t("raffle.wonSeasonTitle", { who: shortAddress(raffle.winner), season: seasonTitle(raffle, t) })
        : t("raffle.endedTitle", { season: seasonTitle(raffle, t) });

  const state = raffle.state === "cancelled" ? t("raffle.badgeCancelled") : t("raffle.badgeEnded");

  return (
    <Frame tone="muted" label={t("raffle.cardLabel", { state })}>
      <div className="flex items-center gap-2 flex-wrap">
        <RaffleBadge raffle={raffle} />
        <span className="font-semibold">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("raffle.endedBody", { season: seasonTitle(raffle, t), symbol })}
      </p>
      <OpenSeasonCta label={t("raffle.openNext")} token={token} />
    </Frame>
  );
};

RaffleCard.propTypes = {
  token: PropTypes.string.isRequired,
  symbol: PropTypes.string,
  market: PropTypes.shape({ fdv: PropTypes.any, totalSupplyRaw: PropTypes.any, quote: PropTypes.object }),
};

export default RaffleCard;
