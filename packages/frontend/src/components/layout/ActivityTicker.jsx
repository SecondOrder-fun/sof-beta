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
// The loop is two identical copies sliding by half the track. A sparse row
// repeats its items inside each copy until one copy spans the row, so items
// always enter from the right. Only the first instance of each item is exposed
// to assistive tech and the tab order; every repeat, and the whole second
// copy, is aria-hidden with its links at tabIndex -1.
//
// Each item is a sentence that stands on its own (see lib/activityItems): the
// compact (mobile) layout drops the wallet and the tail, and the "·" separator
// is drawn only in front of a tail that is shown, so none is left dangling.
//
// Reads GET /api/activity. Renders nothing until the first response arrives
// and when both rows are empty — an empty bar is noise on every page. A failed
// refetch keeps showing the last data rather than dropping the bar.

import { Fragment, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CircleArrowUp, Pause, Play, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useActivityFeed } from "@/hooks/useLaunchActivity";
import { TONE_CLASS, describeRaffleItem, describeTokenItem, withUniqueKeys } from "@/lib/activityItems";
import { cn } from "@/lib/utils";

/** Seconds each item spends crossing the row; keeps speed constant as rows grow. */
const SECONDS_PER_ITEM = 6;

/** Most times a sparse row's items repeat inside one copy of the loop. */
const MAX_REPEAT = 10;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * How many times to repeat `itemCount` items inside one copy so the copy is at
 * least as wide as the row. Measured, and re-measured when the row or the
 * copy resizes; 1 where there is no ResizeObserver or layout (jsdom), and
 * with reduced motion, where the row does not move.
 */
function useFillRepeat(itemCount) {
  const viewportRef = useRef(null);
  const copyRef = useRef(null);
  const [repeat, setRepeat] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy || itemCount === 0) return undefined;

    const measure = () => {
      if (prefersReducedMotion()) {
        setRepeat(1);
        return;
      }
      const rowWidth = viewport.clientWidth;
      const copyWidth = copy.offsetWidth;
      const rendered = copy.children.length;
      if (!rowWidth || !copyWidth || !rendered) return;
      // Width of one pass over the items, from what is rendered now.
      const perPass = (copyWidth * itemCount) / rendered;
      setRepeat(Math.min(MAX_REPEAT, Math.max(1, Math.ceil(rowWidth / perPass))));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [itemCount]);

  return { viewportRef, copyRef, repeat };
}

/** Styling per sentence part: the verb takes the item's tone, a $SYMBOL chip stands out. */
const partClass = (kind, tone) =>
  kind === "verb" ? cn("font-semibold", TONE_CLASS[tone]) : kind === "symbol" ? "font-semibold text-heading" : undefined;

const TickerItem = ({ item, compact, hidden, className }) => {
  const { t } = useTranslation("launchpad");
  const tail = compact ? [] : item.tail;
  return (
    <li aria-hidden={hidden ? "true" : undefined} className={className}>
      <Link
        to={item.href}
        tabIndex={hidden ? -1 : undefined}
        className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        {!compact && item.who ? <span className="font-mono text-xs">{item.who}</span> : null}
        {item.parts.map((part, i) => (
          <span key={`p${i}`} className={partClass(part.kind, item.tone)}>
            {part.text}
          </span>
        ))}
        {tail.map((text, i) => (
          <Fragment key={`t${i}`}>
            <span aria-hidden="true">{t("ticker.separator")}</span>
            <span>{text}</span>
          </Fragment>
        ))}
      </Link>
    </li>
  );
};

TickerItem.propTypes = {
  item: PropTypes.object.isRequired,
  compact: PropTypes.bool,
  hidden: PropTypes.bool,
  className: PropTypes.string,
};

const TickerRow = ({ icon: Icon, label, labelClassName, items, emptyText, paused, compact }) => {
  const { viewportRef, copyRef, repeat } = useFillRepeat(items.length);
  const passes = Array.from({ length: repeat }, (_, i) => i);
  const copyClass = cn("flex shrink-0 items-center", compact ? "gap-5 pl-3 pr-5" : "gap-8 pl-5 pr-8");

  return (
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
      <div
        ref={viewportRef}
        className={cn("group min-w-0 flex-1 overflow-hidden", compact ? "text-xs" : "text-[13px]")}
      >
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
            style={{ animationDuration: `${Math.max(20, items.length * repeat * SECONDS_PER_ITEM)}s` }}
          >
            {/* The visible copy. Repeats past the first pass fill a sparse row;
              they are hidden from assistive tech and the tab order, and dropped
              when motion is reduced. */}
            <ul ref={copyRef} className={copyClass}>
              {passes.flatMap((pass) =>
                items.map((item) => (
                  <TickerItem
                    key={`${pass}:${item.key}`}
                    item={item}
                    compact={compact}
                    hidden={pass > 0}
                    className={pass > 0 ? "motion-reduce:hidden" : undefined}
                  />
                )),
              )}
            </ul>
            {/* The loop's second copy: hidden from assistive tech and the tab order,
              and dropped entirely when motion is reduced. */}
            <ul aria-hidden="true" className={cn(copyClass, "motion-reduce:hidden")}>
              {passes.flatMap((pass) =>
                items.map((item) => <TickerItem key={`${pass}:${item.key}`} item={item} compact={compact} hidden />),
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

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
  const { data } = useActivityFeed();
  const [paused, setPaused] = useState(false);

  // No data yet, or the first read failed. A failed refetch keeps `data`.
  if (!data) return null;
  const tokens = withUniqueKeys((data.tokens ?? []).map((i) => describeTokenItem(i, t)).filter(Boolean));
  const raffles = withUniqueKeys((data.raffles ?? []).map((i) => describeRaffleItem(i, t)).filter(Boolean));
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
