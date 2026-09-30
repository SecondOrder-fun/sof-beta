// src/components/launchpad/RaffleCard.jsx
//
// The raffle priced in a launch token, on that token's page. Leads with the
// season the backend features (live > drawing > upcoming > latest result) and
// renders one of six states:
//
//   live      — prize pool, next ticket price, tickets and players, the ticket
//               price ladder (MiniCurveChart), your tickets, and the primary
//               "Enter raffle" CTA
//   upcoming  — opening time and starting ticket price; CTA disabled
//   drawing   — entries closed, VRF drawing; no CTA
//   ended     — winner and prize (or "cancelled"); CTA to open the next season
//   none      — the token has no season yet; CTA to open the first
//   unavailable — the seasons read failed with nothing cached; says so, no CTA
//                 (a failed read is not evidence that there is no raffle)
//
// Composed from existing primitives: Card in a Pastel Rose frame, Badge
// (RaffleBadge), Button, CountdownTimer and MiniCurveChart. The prize pool is
// shown in the token with an ETH equivalent from the pool price — never USD,
// so there is no oracle.

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
import { usePlayerPosition } from "@/hooks/usePlayerPosition";
import { useTokenSeasons } from "@/hooks/useLaunchActivity";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/format";
import { formatFdvEth, formatSupply } from "@/lib/launchFormat";

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
 * The next ticket's price when the indexed current step is missing: the first
 * step whose range the supply has not passed (the ladder's own rule, see
 * MiniCurveChart), else the last step.
 * @param {{ rangeTo: bigint, price: bigint }[]} steps
 * @param {bigint} supply
 * @returns {bigint | null}
 */
const fallbackStepPrice = (steps, supply) => {
  if (!steps?.length) return null;
  return (steps.find((s) => s.rangeTo >= supply) ?? steps[steps.length - 1]).price;
};

const LiveRaffle = ({ raffle, symbol, market }) => {
  const { t } = useTranslation("launchpad");
  const navigate = useNavigate();
  const { curveStep, curveSupply, allBondSteps, isPriceLoading } = useCurveState(raffle.bondingCurve, {
    isActive: true,
  });
  const { position } = usePlayerPosition(raffle.bondingCurve);

  const prizePool = BigInt(raffle.prizePool);
  const prizeEthWei = market?.priceWei != null ? (prizePool * market.priceWei) / 10n ** 18n : null;
  const myTickets = position?.tickets ?? 0n;
  // Skeleton only while a price read is in flight; a missing curve state (e.g.
  // a 404 from the indexer) falls back to the ladder rather than spinning.
  const nextTicketPrice = curveStep?.price ?? fallbackStepPrice(allBondSteps, curveSupply);

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
        {prizeEthWei != null ? (
          <div className="text-sm text-muted-foreground">
            {t("raffle.prizeEth", { eth: formatFdvEth(prizeEthWei, 2) })}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label={t("raffle.nextTicket")}>
          {nextTicketPrice != null ? (
            t("raffle.ticketPrice", { price: formatSupply(nextTicketPrice), symbol })
          ) : isPriceLoading ? (
            <Skeleton className="h-5 w-16" />
          ) : (
            "—"
          )}
        </Stat>
        <Stat label={t("raffle.ticketsSold")}>{Number(raffle.tickets).toLocaleString()}</Stat>
        <Stat label={t("raffle.players")}>{Number(raffle.participants).toLocaleString()}</Stat>
      </div>

      {allBondSteps.length > 0 ? (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("raffle.priceRises")}</span>
            {curveStep ? (
              // The contract's step index is 0-based; people count from 1.
              <span>{t("raffle.step", { step: Number(curveStep.step) + 1, total: allBondSteps.length })}</span>
            ) : null}
          </div>
          <div className="h-16">
            <MiniCurveChart curveSupply={curveSupply} allBondSteps={allBondSteps} currentStep={curveStep} />
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
  market: PropTypes.shape({ priceWei: PropTypes.any }),
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
          ? t("raffle.upcomingBody", { price: formatSupply(startPrice), symbol })
          : t("raffle.upcomingBodyNoPrice")}
      </p>
      <Button type="button" variant="outline" className="w-full" disabled>
        {t("raffle.opensSoonCta")}
      </Button>
    </Frame>
  );
};

UpcomingRaffle.propTypes = { raffle: PropTypes.object.isRequired, symbol: PropTypes.string };

const OpenSeasonCta = ({ label }) => {
  const navigate = useNavigate();
  return (
    <Button type="button" variant="outline" className="w-full" onClick={() => navigate("/create-season")}>
      {label}
    </Button>
  );
};

OpenSeasonCta.propTypes = { label: PropTypes.string.isRequired };

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
        <OpenSeasonCta label={t("raffle.openFirst")} />
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

  // ended / cancelled
  const title =
    raffle.state === "cancelled"
      ? t("raffle.cancelledTitle", { season: seasonTitle(raffle, t) })
      : raffle.winner
        ? t("raffle.wonTitle", {
            who: shortAddress(raffle.winner),
            prize: formatSupply(BigInt(raffle.prizePool)),
            symbol,
          })
        : t("raffle.endedTitle", { season: seasonTitle(raffle, t) });

  return (
    <Frame tone="muted" label={t("raffle.cardLabel", { state: t("raffle.badgeEnded") })}>
      <div className="flex items-center gap-2 flex-wrap">
        <RaffleBadge raffle={raffle} />
        <span className="font-semibold">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("raffle.endedBody", { season: seasonTitle(raffle, t), symbol })}
      </p>
      <OpenSeasonCta label={t("raffle.openNext")} />
    </Frame>
  );
};

RaffleCard.propTypes = {
  token: PropTypes.string.isRequired,
  symbol: PropTypes.string,
  market: PropTypes.shape({ priceWei: PropTypes.any }),
};

export default RaffleCard;
