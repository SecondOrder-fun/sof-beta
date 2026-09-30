// src/components/layout/ActivityTicker.jsx
//
// Site-wide live activity, under the header (approved ticker design): two rows
// that scroll independently — TOKENS (buys, sells, launches) on top, RAFFLES
// (entries, openings, closings, wins) below. An InfoFi markets row slots in as
// a third <TickerRow> with no layout change.
//
// Motion rules (WCAG 2.2.2): hovering or focusing a row pauses it; the pause
// button stops both; with prefers-reduced-motion the rows stay still and show
// the latest items. Every item links to its token or season.
//
// Reads GET /api/activity. Renders nothing while loading, on error, or when
// both rows are empty — an empty bar is noise on every page.

import { useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CircleArrowUp, Pause, Play, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useActivityFeed } from "@/hooks/useLaunchActivity";
import { TONE_CLASS, describeRaffleItem, describeTokenItem } from "@/lib/activityItems";
import { cn } from "@/lib/utils";

/** Seconds each item spends crossing the row; keeps speed constant as rows grow. */
const SECONDS_PER_ITEM = 6;

const TickerItem = ({ item, compact, hidden }) => (
  <li>
    <Link
      to={item.href}
      tabIndex={hidden ? -1 : undefined}
      className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    >
      {!compact && item.who ? <span className="font-mono text-xs">{item.who}</span> : null}
      <span className={cn("font-semibold", TONE_CLASS[item.tone])}>{item.verb}</span>
      {item.amount ? <span>{item.amount}</span> : null}
      {item.symbol ? <span className="font-semibold text-heading">{item.symbol}</span> : null}
      {!compact && item.tail ? <span>{item.tail}</span> : null}
    </Link>
  </li>
);

TickerItem.propTypes = {
  item: PropTypes.object.isRequired,
  compact: PropTypes.bool,
  hidden: PropTypes.bool,
};

const TickerRow = ({ icon: Icon, label, labelClassName, items, emptyText, paused, compact }) => (
  <div className="flex h-9 items-center border-b last:border-b-0">
    <span
      className={cn(
        "flex h-full shrink-0 items-center gap-2 border-r bg-card text-[11px] font-semibold tracking-[0.08em]",
        compact ? "w-9 justify-center" : "w-[104px] pl-5",
        labelClassName,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label.toUpperCase()}
    </span>
    <div className={cn("group min-w-0 flex-1 overflow-hidden", compact ? "text-xs" : "text-[13px]")}>
      {items.length === 0 ? (
        <span className="pl-5 text-muted-foreground">{emptyText}</span>
      ) : (
        <div
          data-testid="ticker-track"
          data-paused={paused ? "true" : "false"}
          className={cn(
            "flex w-max animate-ticker motion-reduce:animate-none",
            "group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]",
            paused && "[animation-play-state:paused]",
          )}
          style={{ animationDuration: `${Math.max(20, items.length * SECONDS_PER_ITEM)}s` }}
        >
          <ul className={cn("flex shrink-0 items-center", compact ? "gap-5 pl-3 pr-5" : "gap-8 pl-5 pr-8")}>
            {items.map((item) => (
              <TickerItem key={item.key} item={item} compact={compact} />
            ))}
          </ul>
          {/* The loop's second copy: hidden from assistive tech and the tab order,
              and dropped entirely when motion is reduced. */}
          <ul
            aria-hidden="true"
            className={cn("flex shrink-0 items-center motion-reduce:hidden", compact ? "gap-5 pl-3 pr-5" : "gap-8 pl-5 pr-8")}
          >
            {items.map((item) => (
              <TickerItem key={item.key} item={item} compact={compact} hidden />
            ))}
          </ul>
        </div>
      )}
    </div>
  </div>
);

TickerRow.propTypes = {
  icon: PropTypes.elementType.isRequired,
  label: PropTypes.string.isRequired,
  labelClassName: PropTypes.string,
  items: PropTypes.array.isRequired,
  emptyText: PropTypes.string.isRequired,
  paused: PropTypes.bool,
  compact: PropTypes.bool,
};

const ActivityTicker = ({ compact = false }) => {
  const { t } = useTranslation("launchpad");
  const { data, isError } = useActivityFeed();
  const [paused, setPaused] = useState(false);

  if (isError || !data) return null;
  const tokens = (data.tokens ?? []).map((i) => describeTokenItem(i, t)).filter(Boolean);
  const raffles = (data.raffles ?? []).map((i) => describeRaffleItem(i, t)).filter(Boolean);
  if (tokens.length === 0 && raffles.length === 0) return null;

  return (
    <section aria-label={t("ticker.label")} className="flex border-b bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <TickerRow
          icon={CircleArrowUp}
          label={t("ticker.tokens")}
          labelClassName="text-muted-foreground"
          items={tokens}
          emptyText={t("ticker.tokensEmpty")}
          paused={paused}
          compact={compact}
        />
        <TickerRow
          icon={Ticket}
          label={t("ticker.raffles")}
          labelClassName="text-raffle"
          items={raffles}
          emptyText={t("ticker.rafflesEmpty")}
          paused={paused}
          compact={compact}
        />
      </div>
      <Button
        type="button"
        variant="link"
        size="icon"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        aria-label={paused ? t("ticker.resume") : t("ticker.pause")}
        className={cn("h-auto shrink-0 self-stretch rounded-none border-l no-underline", compact ? "w-11" : "w-14")}
      >
        {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </section>
  );
};

ActivityTicker.propTypes = {
  compact: PropTypes.bool,
};

export default ActivityTicker;
