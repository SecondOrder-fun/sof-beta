// src/lib/activityItems.js
//
// Shapes GET /api/activity rows into what the ticker renders:
//
//   who  parts…  · tail · tail
//
// `parts` is the item's sentence (a coloured verb, plain text, $SYMBOL chips)
// and must make sense on its own: the compact (mobile) ticker drops `who` and
// `tail`. No translated string carries a separator — the ticker draws "·"
// only between a sentence and a tail it actually shows, so nothing dangles.
//
// Pure (the translator is passed in), so each event kind's wording and link
// target is tested without rendering the ticker.
//
// Keys must be unique within a row: one transaction can carry several events
// (a batched buy, two entries by one wallet). The feed's `logIndex` is the
// key when present; otherwise the next-best field stands in (the token for
// trades, the wallet for entries) and withUniqueKeys numbers what still
// collides, in feed order. A closing season has no transaction and is keyed by
// its season.

import { shortAddress } from '@/lib/format';
import { formatEthAmount, formatFdvEth, formatSupply, formatTimeLeft } from '@/lib/launchFormat';
import { DEFAULT_WHOLE_SUPPLY } from '@/lib/launchChart';
import { grandPrizeWei } from '@/lib/prizeMath';

/** Tone -> text colour. Buys and sells use the trade colours; raffles take Pastel Rose. */
export const TONE_CLASS = {
  buy: 'text-success',
  sell: 'text-destructive',
  launch: 'text-fabric-red',
  raffle: 'text-raffle',
  closing: 'text-fabric-red',
};

const verb = (text) => ({ kind: 'verb', text });
const plain = (text) => ({ kind: 'text', text });
const chip = (symbol) => ({ kind: 'symbol', text: `$${symbol}` });

/** Drop the parts a row does not have. */
const present = (list) => list.filter(Boolean);

/** "Season 3 on $POND", or just "Season 3" when the season has no launch token. */
const seasonParts = (item, season, t) =>
  item.symbol ? [plain(t('ticker.seasonOn', { season })), chip(item.symbol)] : [plain(season)];

/**
 * @param {object} item  one `tokens` row
 * @param {(key: string, opts?: object) => string} t  launchpad-namespace translator
 */
export function describeTokenItem(item, t) {
  const base = {
    key: `${item.kind}:${item.txHash}:${item.logIndex ?? item.token}`,
    href: `/tokens/${item.token}`,
    who: item.who ? shortAddress(item.who) : null,
  };
  if (item.kind === 'launch') {
    return {
      ...base,
      tone: 'launch',
      // With no symbol indexed yet, the address names the token.
      parts: [verb(t('ticker.launched')), item.symbol ? chip(item.symbol) : plain(shortAddress(item.token))],
      tail: [t('ticker.fdv', { fdv: formatFdvEth(BigInt(item.fdvWei ?? 0), 1) })],
    };
  }
  // A trade can be tiny; keep its significant digits rather than show "0 ETH".
  const eth = formatEthAmount(item.ethAmount ?? 0);
  const fdvWei = item.priceWei ? BigInt(item.priceWei) * DEFAULT_WHOLE_SUPPLY : null;
  return {
    ...base,
    tone: item.kind === 'buy' ? 'buy' : 'sell',
    parts: present([
      verb(t(item.kind === 'buy' ? 'ticker.bought' : 'ticker.sold')),
      // "0.4 ETH of $POND"; no dangling "of" when the symbol is unknown.
      plain(item.symbol ? t('ticker.ethOf', { eth }) : t('ticker.eth', { eth })),
      item.symbol ? chip(item.symbol) : null,
    ]),
    tail: present([fdvWei != null ? t('ticker.fdv', { fdv: formatFdvEth(fdvWei, 1) }) : null]),
  };
}

/**
 * @param {object} item  one `raffles` row
 * @param {(key: string, opts?: object) => string} t
 * @param {number} [nowMs=Date.now()]
 */
export function describeRaffleItem(item, t, nowMs = Date.now()) {
  const season = item.seasonName || t('raffle.season', { id: item.seasonId });
  // opened / won happen once per season, in one transaction; an entry is one
  // log in a transaction, keyed by its log index, else by its wallet
  // (withUniqueKeys separates one wallet's two entries in one transaction).
  // A closing season is a state, not an event: it has no transaction, and the
  // feed stamps its `at` with the request time, so it is keyed by the season
  // alone — keying by `at` would remount it on every refetch.
  const disambiguator = item.logIndex ?? (item.kind === 'entry' ? item.who : null);
  const base = {
    key:
      item.kind === 'closing'
        ? `closing:${item.seasonId}`
        : `${item.kind}:${item.seasonId}:${item.txHash ?? item.at}${disambiguator != null ? `:${disambiguator}` : ''}`,
    href: `/raffles/${item.seasonId}`,
    who: item.who ? shortAddress(item.who) : null,
    tone: 'raffle',
  };
  switch (item.kind) {
    case 'entry':
      return {
        ...base,
        parts: [verb(t('ticker.entered')), ...seasonParts(item, season, t)],
        tail: [t('ticker.tickets', { count: Number(item.tickets) })],
      };
    case 'won': {
      // The grand prize, never the whole pool (the pool also funds the
      // consolation share). Unknown, or no token to name it in: say which
      // season was won and claim no amount.
      const prize = grandPrizeWei(item);
      if (prize != null && item.symbol) {
        return {
          ...base,
          parts: [verb(t('ticker.won')), plain(t('ticker.prize', { prize: formatSupply(prize), symbol: item.symbol }))],
          tail: [season],
        };
      }
      return { ...base, parts: [verb(t('ticker.won')), ...seasonParts(item, season, t)], tail: [] };
    }
    case 'opened':
      return { ...base, parts: [verb(t('ticker.opened')), ...seasonParts(item, season, t)], tail: [] };
    case 'closing':
      return {
        ...base,
        tone: 'closing',
        parts: [
          verb(t('ticker.closing')),
          ...seasonParts(item, season, t),
          plain(t('ticker.inTime', { time: formatTimeLeft(item.endsAt, t, nowMs) })),
        ],
        tail: [t('ticker.players', { count: Number(item.participants ?? 0) })],
      };
    default:
      return null;
  }
}

/**
 * Number the keys that still collide after describing — e.g. one wallet's two
 * entries in one transaction when the feed has no log index — so React sees
 * each item once. The first keeps its key; later ones get `#1`, `#2`… in feed
 * order, which is stable across refetches of the same feed.
 * @template {{ key: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function withUniqueKeys(items) {
  const seen = new Map();
  return items.map((item) => {
    const n = seen.get(item.key) ?? 0;
    seen.set(item.key, n + 1);
    return n === 0 ? item : { ...item, key: `${item.key}#${n}` };
  });
}
