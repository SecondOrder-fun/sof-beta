import { describe, it, expect } from "vitest";
import { describeRaffleItem, describeTokenItem, TONE_CLASS } from "@/lib/activityItems";

// Echo the key and options, so assertions pin both the wording key and its values.
const t = (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key);

const TOKEN = "0x1111111111111111111111111111111111111111";
const WALLET = "0x3f000000000000000000000000000000000000a1";
const ETH = 10n ** 18n;
const GWEI = 10n ** 9n;

describe("describeTokenItem", () => {
  it("shapes a buy: wallet, ETH in, token, FDV after — linked to the token", () => {
    const d = describeTokenItem(
      { kind: "buy", who: WALLET, token: TOKEN, symbol: "POND", ethAmount: String(4n * ETH / 10n), priceWei: String(47n * GWEI), txHash: "0xabc" },
      t,
    );
    expect(d).toMatchObject({
      href: `/tokens/${TOKEN}`,
      tone: "buy",
      verb: "ticker.bought",
      symbol: "$POND",
      amount: 'ticker.ethOf{"eth":"0.4"}',
      tail: 'ticker.fdvAfter{"fdv":"47"}',
    });
    expect(d.who).toMatch(/^0x3f/);
  });

  it("shapes a sell with the sell tone", () => {
    const d = describeTokenItem({ kind: "sell", who: WALLET, token: TOKEN, symbol: "ORB", ethAmount: "1", priceWei: "1", txHash: "0x1" }, t);
    expect(d.tone).toBe("sell");
    expect(d.verb).toBe("ticker.sold");
  });

  it("shapes a launch with its starting FDV and no amount", () => {
    const d = describeTokenItem({ kind: "launch", who: WALLET, token: TOKEN, symbol: "SALT", fdvWei: String(ETH), txHash: "0x2" }, t);
    expect(d).toMatchObject({ tone: "launch", verb: "ticker.launched", amount: null, tail: 'ticker.atFdv{"fdv":"1"}' });
  });

  it("gives every tone a colour", () => {
    for (const tone of ["buy", "sell", "launch", "raffle", "closing"]) expect(TONE_CLASS[tone]).toBeTruthy();
  });
});

describe("describeRaffleItem", () => {
  const base = { seasonId: 3, seasonName: null, token: TOKEN, symbol: "POND" };

  it("shapes an entry: wallet, tickets, token, season — linked to the season", () => {
    const d = describeRaffleItem({ ...base, kind: "entry", who: WALLET, tickets: "40", txHash: "0x1", at: "x" }, t);
    expect(d).toMatchObject({
      href: "/raffles/3",
      tone: "raffle",
      verb: "ticker.entered",
      amount: 'ticker.tickets{"count":40}',
      symbol: "$POND",
      tail: 'raffle.season{"id":3}',
    });
  });

  it("shapes a win with the prize in the token", () => {
    const d = describeRaffleItem({ ...base, kind: "won", who: WALLET, prizePool: String(18_400_000n * ETH), at: "x" }, t);
    expect(d.amount).toBe("18.4M POND ·");
  });

  it("prefers the season's own name", () => {
    const d = describeRaffleItem({ ...base, seasonName: "Frog Fest", kind: "opened", at: "x" }, t);
    expect(d.amount).toBe('ticker.seasonOn{"season":"Frog Fest"}');
  });

  it("shapes a closing season with the time left and player count", () => {
    const nowMs = 1_700_000_000_000;
    const d = describeRaffleItem({ ...base, kind: "closing", endsAt: nowMs / 1000 + 9 * 60, participants: "212", at: "x" }, t, nowMs);
    expect(d).toMatchObject({
      tone: "closing",
      verb: "ticker.closing",
      amount: 'ticker.closingIn{"time":"9m"}',
      tail: 'ticker.seasonPlayers{"season":"raffle.season{\\"id\\":3}","count":212}',
    });
  });

  it("leaves the token out for a season not priced in a launch token", () => {
    const d = describeRaffleItem({ ...base, token: null, symbol: null, kind: "entry", who: WALLET, tickets: "1", txHash: "0x9", at: "x" }, t);
    expect(d.symbol).toBeNull();
  });

  it("ignores kinds it does not know", () => {
    expect(describeRaffleItem({ ...base, kind: "mystery", at: "x" }, t)).toBeNull();
  });
});
