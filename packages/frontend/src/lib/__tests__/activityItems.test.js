import { describe, it, expect } from "vitest";
import { describeRaffleItem, describeTokenItem, withUniqueKeys, TONE_CLASS } from "@/lib/activityItems";

// Echo the key and options, so assertions pin both the wording key and its values.
const t = (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key);

/** The item's sentence — what the compact ticker shows — as one string. */
const sentence = (d) => d.parts.map((p) => p.text).join(" ");

const TOKEN = "0x1111111111111111111111111111111111111111";
const WALLET = "0x3f000000000000000000000000000000000000a1";
const ETH = 10n ** 18n;
const GWEI = 10n ** 9n;

// A season on $POND, as the feed labels it; "Season 3" through the echo translator.
const SEASON = 'raffle.season{"id":3}';
const SEASON_ON = `ticker.seasonOn{"season":"raffle.season{\\"id\\":3}"}`;

describe("describeTokenItem", () => {
  it("shapes a buy: wallet, ETH in, token, FDV after — linked to the token", () => {
    const d = describeTokenItem(
      { kind: "buy", who: WALLET, token: TOKEN, symbol: "POND", ethAmount: String(4n * ETH / 10n), priceWei: String(47n * GWEI), txHash: "0xabc" },
      t,
    );
    expect(d).toMatchObject({ href: `/tokens/${TOKEN}`, tone: "buy", tail: ['ticker.fdv{"fdv":"47"}'] });
    expect(d.parts).toEqual([
      { kind: "verb", text: "ticker.bought" },
      { kind: "text", text: 'ticker.ethOf{"eth":"0.4"}' },
      { kind: "symbol", text: "$POND" },
    ]);
    expect(d.who).toMatch(/^0x3f/);
  });

  it("keeps a small trade's significant digits instead of rounding it to 0 ETH", () => {
    const row = { kind: "buy", who: WALLET, token: TOKEN, symbol: "POND", priceWei: String(47n * GWEI), txHash: "0x1" };
    expect(describeTokenItem({ ...row, ethAmount: String(4n * ETH / 1000n) }, t).parts[1].text).toBe('ticker.ethOf{"eth":"0.004"}');
    expect(describeTokenItem({ ...row, ethAmount: "47200000000000" }, t).parts[1].text).toBe('ticker.ethOf{"eth":"0.0000472"}');
  });

  it("shapes a sell with the sell tone", () => {
    const d = describeTokenItem({ kind: "sell", who: WALLET, token: TOKEN, symbol: "ORB", ethAmount: "1", priceWei: "1", txHash: "0x1" }, t);
    expect(d.tone).toBe("sell");
    expect(d.parts[0].text).toBe("ticker.sold");
  });

  it("leaves no dangling 'of' when a trade's token has no symbol", () => {
    const d = describeTokenItem({ kind: "buy", who: WALLET, token: TOKEN, symbol: null, ethAmount: String(ETH), priceWei: "1", txHash: "0x1" }, t);
    expect(sentence(d)).toBe('ticker.bought ticker.eth{"eth":"1"}');
  });

  it("shapes a launch with its starting FDV as the tail", () => {
    const d = describeTokenItem({ kind: "launch", who: WALLET, token: TOKEN, symbol: "SALT", fdvWei: String(ETH), txHash: "0x2" }, t);
    expect(d).toMatchObject({ tone: "launch", tail: ['ticker.fdv{"fdv":"1"}'] });
    expect(sentence(d)).toBe("ticker.launched $SALT");
  });

  it("names a launch by address when its symbol is not indexed yet", () => {
    const d = describeTokenItem({ kind: "launch", who: WALLET, token: TOKEN, symbol: null, fdvWei: String(ETH), txHash: "0x2" }, t);
    expect(d.parts).toHaveLength(2);
    expect(d.parts[1].text).toMatch(/^0x1111/);
  });

  it("keys each event of a batched transaction separately", () => {
    const row = { kind: "buy", who: WALLET, token: TOKEN, symbol: "POND", ethAmount: "1", priceWei: "1", txHash: "0xabc" };
    const a = describeTokenItem({ ...row, logIndex: 3 }, t);
    const b = describeTokenItem({ ...row, logIndex: 7 }, t);
    expect(a.key).not.toBe(b.key);
    // Without a log index, two tokens bought in one tx still get distinct keys.
    const other = "0x2222222222222222222222222222222222222222";
    expect(describeTokenItem(row, t).key).not.toBe(describeTokenItem({ ...row, token: other }, t).key);
  });

  it("gives every tone a colour", () => {
    for (const tone of ["buy", "sell", "launch", "raffle", "closing"]) expect(TONE_CLASS[tone]).toBeTruthy();
  });
});

describe("describeRaffleItem", () => {
  const base = { seasonId: 3, seasonName: null, token: TOKEN, symbol: "POND" };

  it("shapes an entry: wallet, the season on its token, and the tickets as the tail — linked to the season", () => {
    const d = describeRaffleItem({ ...base, kind: "entry", who: WALLET, tickets: "40", txHash: "0x1", at: "x" }, t);
    expect(d).toMatchObject({ href: "/raffles/3", tone: "raffle", tail: ['ticker.tickets{"count":40}'] });
    expect(d.parts).toEqual([
      { kind: "verb", text: "ticker.entered" },
      { kind: "text", text: SEASON_ON },
      { kind: "symbol", text: "$POND" },
    ]);
  });

  it("keys two entries in one transaction by their log index", () => {
    const row = { ...base, kind: "entry", who: WALLET, tickets: "1", txHash: "0x1", at: "x" };
    const a = describeRaffleItem({ ...row, logIndex: 1 }, t);
    const b = describeRaffleItem({ ...row, logIndex: 2 }, t);
    expect(a.key).not.toBe(b.key);
    const other = "0x4000000000000000000000000000000000000000";
    expect(describeRaffleItem(row, t).key).not.toBe(describeRaffleItem({ ...row, who: other }, t).key);
  });

  describe("a win", () => {
    const won = { ...base, kind: "won", who: WALLET, prizePool: String(20_000_000n * ETH), at: "x" };

    it("names the indexed grand prize, not the whole pool", () => {
      const d = describeRaffleItem({ ...won, grandPrize: String(13_000_000n * ETH) }, t);
      expect(d.parts).toEqual([
        { kind: "verb", text: "ticker.won" },
        // The prize names its token; no second $POND chip.
        { kind: "text", text: 'ticker.prize{"prize":"13M","symbol":"POND"}' },
      ]);
      expect(d.tail).toEqual([SEASON]);
    });

    it("applies the season's grand-prize share when only the bps is known", () => {
      const d = describeRaffleItem({ ...won, grandPrizeBps: 6500 }, t);
      expect(d.parts[1].text).toBe('ticker.prize{"prize":"13M","symbol":"POND"}');
    });

    it("claims no amount when the winner's share is unknown", () => {
      const d = describeRaffleItem(won, t);
      expect(sentence(d)).toBe(`ticker.won ${SEASON_ON} $POND`);
      expect(sentence(d)).not.toMatch(/20M/);
      expect(d.tail).toEqual([]);
    });

    it("without a known token, is the season alone", () => {
      const d = describeRaffleItem({ ...won, symbol: null, grandPrize: String(ETH) }, t);
      expect(sentence(d)).toBe(`ticker.won ${SEASON}`);
      expect(d.tail).toEqual([]);
    });
  });

  it("shapes an opening as the season on its token", () => {
    const d = describeRaffleItem({ ...base, kind: "opened", at: "x" }, t);
    expect(sentence(d)).toBe(`ticker.opened ${SEASON_ON} $POND`);
    expect(d.tail).toEqual([]);
  });

  it("shapes an opening without a token as the season alone, with no dangling 'on'", () => {
    const d = describeRaffleItem({ ...base, symbol: null, kind: "opened", at: "x" }, t);
    expect(sentence(d)).toBe(`ticker.opened ${SEASON}`);
  });

  it("prefers the season's own name", () => {
    const d = describeRaffleItem({ ...base, seasonName: "Frog Fest", kind: "opened", at: "x" }, t);
    expect(d.parts[1].text).toBe('ticker.seasonOn{"season":"Frog Fest"}');
  });

  it("shapes a closing season: which season and when in the sentence, players in the tail", () => {
    const nowMs = 1_700_000_000_000;
    const d = describeRaffleItem({ ...base, kind: "closing", endsAt: nowMs / 1000 + 9 * 60, participants: "212", at: "x" }, t, nowMs);
    expect(d.tone).toBe("closing");
    // The time's unit goes through the translator too: no hardcoded "m".
    expect(sentence(d)).toBe(`ticker.closing ${SEASON_ON} $POND ticker.inTime{"time":"time.minutes{\\"count\\":9}"}`);
    expect(d.tail).toEqual(['ticker.players{"count":212}']);
  });

  it("keys a closing season by the season alone, so a refetch (which restamps `at`) keeps the same item", () => {
    const row = { ...base, kind: "closing", endsAt: 1_700_000_600, participants: "2" };
    const first = describeRaffleItem({ ...row, at: "2026-09-30T00:00:00Z" }, t, 1_700_000_000_000);
    const refetched = describeRaffleItem({ ...row, at: "2026-09-30T00:00:15Z" }, t, 1_700_000_015_000);
    expect(first.key).toBe("closing:3");
    expect(refetched.key).toBe(first.key);
    // Another season closing at the same time is a different item.
    expect(describeRaffleItem({ ...row, seasonId: 4, at: "2026-09-30T00:00:00Z" }, t).key).not.toBe(first.key);
  });

  it("leaves the token out for a season not priced in a launch token", () => {
    const d = describeRaffleItem({ ...base, token: null, symbol: null, kind: "entry", who: WALLET, tickets: "1", txHash: "0x9", at: "x" }, t);
    expect(d.parts.some((p) => p.kind === "symbol")).toBe(false);
    expect(sentence(d)).toBe(`ticker.entered ${SEASON}`);
  });

  it("bakes no separator into any translated part", () => {
    const nowMs = 1_700_000_000_000;
    const real = (key, opts) => ({ "ticker.tickets": `${opts?.count} tickets` })[key] ?? key;
    const rows = [
      { ...base, kind: "entry", who: WALLET, tickets: "2", txHash: "0x1", at: "x" },
      { ...base, kind: "won", who: WALLET, prizePool: "1", grandPrizeBps: 6500, at: "x" },
      { ...base, kind: "closing", endsAt: nowMs / 1000 + 60, participants: "2", at: "x" },
    ];
    for (const row of rows) {
      const d = describeRaffleItem(row, real, nowMs);
      [...d.parts.map((p) => p.text), ...d.tail].forEach((text) => expect(text).not.toMatch(/·/));
    }
  });

  it("ignores kinds it does not know", () => {
    expect(describeRaffleItem({ ...base, kind: "mystery", at: "x" }, t)).toBeNull();
  });
});

describe("withUniqueKeys", () => {
  it("separates one wallet's two entries in one transaction when the feed has no log index", () => {
    const row = { ...{ seasonId: 3, seasonName: null, token: TOKEN, symbol: "POND" }, kind: "entry", who: WALLET, tickets: "1", txHash: "0x1", at: "x" };
    const items = withUniqueKeys([describeRaffleItem(row, t), describeRaffleItem(row, t), describeRaffleItem(row, t)]);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(3);
    // Deterministic: the same feed keys the same way on every refetch.
    expect(withUniqueKeys([describeRaffleItem(row, t), describeRaffleItem(row, t), describeRaffleItem(row, t)]).map((i) => i.key)).toEqual(keys);
    // The first keeps its natural key.
    expect(keys[0]).toBe(describeRaffleItem(row, t).key);
  });

  it("leaves already-unique keys alone", () => {
    const items = [{ key: "a" }, { key: "b" }];
    expect(withUniqueKeys(items)).toEqual(items);
  });
});
