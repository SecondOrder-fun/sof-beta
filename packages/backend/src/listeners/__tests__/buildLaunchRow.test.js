// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildLaunchRow,
  storableText,
  MAX_NAME_CHARS,
  MAX_SYMBOL_CHARS,
  MAX_METADATA_URI_CHARS,
} from "../buildLaunchRow.js";

const WAD = 10n ** 18n;
const TOTAL_SUPPLY = 1_000_000_000n * WAD;

const log = ({ args: argOverrides, ...logOverrides } = {}) => ({
  blockNumber: 1234n,
  transactionHash: "0xDEADBEEF",
  topics: [],
  ...logOverrides,
  args: {
    launchId: 3n,
    token: "0x1111111111111111111111111111111111111111",
    creator: "0x2222222222222222222222222222222222222222",
    name: "Second Order",
    symbol: "SOF",
    metadataURI: "ipfs://meta",
    startPriceWei: 1_000_000_000n, // 1 gwei per token
    placementId: `0x${"ab".repeat(32)}`,
    ...argOverrides,
  },
});

describe("buildLaunchRow", () => {
  it("maps a TokenLaunched log onto a token_launches row", () => {
    const row = buildLaunchRow(log(), TOTAL_SUPPLY, 1_700_000_000);

    expect(row.token_address).toBe("0x1111111111111111111111111111111111111111");
    expect(row.creator_address).toBe("0x2222222222222222222222222222222222222222");
    expect(row.launch_id).toBe(3);
    expect(row.name).toBe("Second Order");
    expect(row.symbol).toBe("SOF");
    expect(row.metadata_uri).toBe("ipfs://meta");
    expect(row.block_number).toBe(1234);
    expect(row.tx_hash).toBe("0xDEADBEEF");
    expect(row.launched_at).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  // Implied FDV is price * WHOLE tokens. Multiplying by the raw 18-decimal
  // supply instead is an error of 1e18 that would look perfectly plausible
  // sitting in a column of wei.
  it("derives implied FDV from whole tokens, not raw supply", () => {
    const row = buildLaunchRow(log(), TOTAL_SUPPLY, 1_700_000_000);
    // 1 gwei/token * 1e9 tokens = 1e18 wei = 1 ETH
    expect(row.implied_fdv_wei).toBe(WAD.toString());
  });

  it("keeps wei values as strings so precision survives", () => {
    const row = buildLaunchRow(
      log({ args: { startPriceWei: 999_999_999_999n } }),
      TOTAL_SUPPLY,
      1,
    );
    expect(row.start_price_wei).toBe("999999999999");
    expect(typeof row.implied_fdv_wei).toBe("string");
    expect(row.implied_fdv_wei).toBe((999_999_999_999n * 1_000_000_000n).toString());
  });

  // placementId is the v4 PoolId, and the trade listener matches Swap logs on
  // it. A zero hash means no pool, and storing it would have the trade listener
  // attributing swaps to a token that has none.
  it("stores a zero placementId as null rather than a zero hash", () => {
    const row = buildLaunchRow(
      log({ args: { placementId: `0x${"0".repeat(64)}` } }),
      TOTAL_SUPPLY,
      1,
    );
    expect(row.pool_id).toBeNull();
  });

  it("keeps a real placementId as the pool id", () => {
    const row = buildLaunchRow(log(), TOTAL_SUPPLY, 1);
    expect(row.pool_id).toBe(`0x${"ab".repeat(32)}`);
  });

  it("normalises an empty metadata URI to null", () => {
    const row = buildLaunchRow(log({ args: { metadataURI: "" } }), TOTAL_SUPPLY, 1);
    expect(row.metadata_uri).toBeNull();
  });

  // A missing block timestamp must not drop the launch — the row is the only
  // record of the token's name and symbol.
  it("falls back to now when the block timestamp is unavailable", () => {
    const before = Date.now();
    const row = buildLaunchRow(log(), TOTAL_SUPPLY, undefined);
    const at = new Date(row.launched_at).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("returns null for a log with no decoded args", () => {
    expect(buildLaunchRow({ args: {} }, TOTAL_SUPPLY, 1)).toBeNull();
    expect(buildLaunchRow({}, TOTAL_SUPPLY, 1)).toBeNull();
    expect(buildLaunchRow(null, TOTAL_SUPPLY, 1)).toBeNull();
  });

  it("returns null when the creator is missing", () => {
    expect(buildLaunchRow(log({ args: { creator: undefined } }), TOTAL_SUPPLY, 1)).toBeNull();
  });
});

// A row the database rejects for good would otherwise be retried forever, so
// event strings are made storable before the insert.
describe("buildLaunchRow text normalisation", () => {
  it("drops U+0000, which Postgres TEXT cannot hold", () => {
    const row = buildLaunchRow(
      log({ args: { name: "Se\u0000cond", symbol: "\u0000SOF", metadataURI: "ipfs://a\u0000b" } }),
      TOTAL_SUPPLY,
      1,
    );
    expect(row.name).toBe("Second");
    expect(row.symbol).toBe("SOF");
    expect(row.metadata_uri).toBe("ipfs://ab");
  });

  it("cuts name and symbol to the launchpad's limits, never inside a character", () => {
    const row = buildLaunchRow(
      log({ args: { name: "🐸".repeat(MAX_NAME_CHARS + 5), symbol: "X".repeat(MAX_SYMBOL_CHARS + 1) } }),
      TOTAL_SUPPLY,
      1,
    );
    expect(Array.from(row.name)).toHaveLength(MAX_NAME_CHARS);
    expect(row.name).toBe("🐸".repeat(MAX_NAME_CHARS)); // no lone surrogate at the cut
    expect(row.symbol).toBe("X".repeat(MAX_SYMBOL_CHARS));
  });

  it("leaves names within the limits untouched", () => {
    const row = buildLaunchRow(log({ args: { name: "N".repeat(MAX_NAME_CHARS) } }), TOTAL_SUPPLY, 1);
    expect(row.name).toBe("N".repeat(MAX_NAME_CHARS));
  });

  // A truncated URI points somewhere else; none at all is the honest value.
  it("drops an over-long metadata URI rather than cutting it", () => {
    const ok = "ipfs://" + "a".repeat(MAX_METADATA_URI_CHARS - 7);
    expect(buildLaunchRow(log({ args: { metadataURI: ok } }), TOTAL_SUPPLY, 1).metadata_uri).toBe(ok);
    expect(buildLaunchRow(log({ args: { metadataURI: `${ok}a` } }), TOTAL_SUPPLY, 1).metadata_uri).toBeNull();
  });

  it("stores an empty or NUL-only name as null", () => {
    expect(storableText("", 10)).toBeNull();
    expect(storableText("\u0000\u0000", 10)).toBeNull();
    expect(storableText(undefined, 10)).toBeNull();
  });
});
