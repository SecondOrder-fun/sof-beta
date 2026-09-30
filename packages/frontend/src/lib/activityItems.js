// src/lib/activityItems.js
//
// Shapes GET /api/activity rows into the parts the ticker renders:
//
//   who · verb · amount · $SYMBOL · tail
//
// Pure (the translator is passed in), so each event kind's wording and link
// target is tested without rendering the ticker.
//
// Keys must be unique within a row: one transaction can carry several events
// (a batched buy, two entries), so a tx hash alone is not enough. The feed's
// `logIndex` disambiguates; until every row carries it, the next-best field
// stands in (the token for trades, the wallet for entries).

import { shortAddress } from '@/lib/format';
import { formatFdvEth, formatSupply, formatTimeLeft } from '@/lib/launchFormat';
import { DEFAULT_WHOLE_SUPPLY } from '@/lib/launchChart';

/** Tone -> text colour. Buys and sells use the trade colours; raffles take Pastel Rose. */
export const TONE_CLASS = {
  buy: 'text-success',
  sell: 'text-destructive',
  launch: 'text-fabric-red',
  raffle: 'text-raffle',
  closing: 'text-fabric-red',
};

const ticker = (symbol) => (symbol ? `$${symbol}` : null);

/**
 * @param {object} item  one `tokens` row
 * @param {(key: string, opts?: object) => string} t  launchpad-namespace translator
 */
export function describeTokenItem(item, t) {
  const base = {
    key: `${item.kind}:${item.txHash}:${item.logIndex ?? item.token}`,
    href: `/tokens/${item.token}`,
    who: item.who ? shortAddress(item.who) : null,
    symbol: ticker(item.symbol),
  };
  if (item.kind === 'launch') {
    return {
      ...base,
      tone: 'launch',
      verb: t('ticker.launched'),
      amount: null,
      tail: t('ticker.atFdv', { fdv: formatFdvEth(BigInt(item.fdvWei ?? 0), 1) }),
    };
  }
  const fdvWei = item.priceWei ? BigInt(item.priceWei) * DEFAULT_WHOLE_SUPPLY : null;
  return {
    ...base,
    tone: item.kind === 'buy' ? 'buy' : 'sell',
    verb: t(item.kind === 'buy' ? 'ticker.bought' : 'ticker.sold'),
    amount: t('ticker.ethOf', { eth: formatFdvEth(BigInt(item.ethAmount ?? 0), 2) }),
    tail: fdvWei != null ? t('ticker.fdvAfter', { fdv: formatFdvEth(fdvWei, 1) }) : null,
  };
}

/**
 * @param {object} item  one `raffles` row
 * @param {(key: string, opts?: object) => string} t
 * @param {number} [nowMs=Date.now()]
 */
export function describeRaffleItem(item, t, nowMs = Date.now()) {
  const season = item.seasonName || t('raffle.season', { id: item.seasonId });
  const base = {
    // opened / closing / won happen once per season; entries need the log index.
    key: `${item.kind}:${item.seasonId}:${item.txHash ?? item.at}:${item.logIndex ?? item.who ?? ''}`,
    href: `/raffles/${item.seasonId}`,
    who: item.who ? shortAddress(item.who) : null,
    symbol: ticker(item.symbol),
    tone: 'raffle',
  };
  switch (item.kind) {
    case 'entry':
      return { ...base, verb: t('ticker.entered'), amount: t('ticker.tickets', { count: Number(item.tickets) }), tail: season };
    case 'won':
      // The prize names its token, so no separate $SYMBOL chip; with no symbol
      // known a bare number would mislead, so the prize is left out.
      return {
        ...base,
        symbol: null,
        verb: t('ticker.won'),
        amount: item.symbol
          ? t('ticker.prize', { prize: formatSupply(BigInt(item.prizePool ?? 0)), symbol: item.symbol })
          : null,
        tail: season,
      };
    case 'opened':
      // "opened Season 3 on $POND", or just "opened Season 3" when the season is
      // not priced in a launch token.
      return {
        ...base,
        verb: t('ticker.opened'),
        amount: item.symbol ? t('ticker.seasonOn', { season }) : t('ticker.season', { season }),
        tail: null,
      };
    case 'closing':
      return {
        ...base,
        tone: 'closing',
        verb: t('ticker.closing'),
        amount: t('ticker.closingIn', { time: formatTimeLeft(item.endsAt, nowMs) }),
        tail: t('ticker.seasonPlayers', { season, count: Number(item.participants ?? 0) }),
      };
    default:
      return null;
  }
}
