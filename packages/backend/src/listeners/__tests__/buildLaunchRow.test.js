// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildLaunchRow,
  ETH_QUOTE,
  NATIVE_QUOTE,
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
    quoteToken: NATIVE_QUOTE,
    startFdv: WAD, // a 1 ETH valuation: 1 gwei per token
    tradeFee: 25_000, // 2.5%
    liquidityPreset: 2, // Thick middle
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
    expect(row.trade_fee).toBe(25_000);
    expect(row.liquidity_preset).toBe(2);
  });

  // Every 0.42 TokenLaunched carries the rate; a row without one would take the
  // column's pre-0.42 default (1%) and misstate the launch's fee for good.
  it("treats a log without a trade fee as unusable", () => {
    expect(buildLaunchRow(log({ args: { tradeFee: undefined } }), TOTAL_SUPPLY, 1)).toBeNull();
    expect(buildLaunchRow(log({ args: { tradeFee: 0 } }), TOTAL_SUPPLY, 1).trade_fee).toBe(0);
  });

  // Every 0.43 TokenLaunched carries the preset; a row without one would take the
  // column's pre-0.43 default (0, Classic) and misstate the launch's liquidity.
  it("treats a log without a liquidity preset as unusable", () => {
    expect(buildLaunchRow(log({ args: { liquidityPreset: undefined } }), TOTAL_SUPPLY, 1)).toBeNull();
    expect(buildLaunchRow(log({ args: { liquidityPreset: null } }), TOTAL_SUPPLY, 1)).toBeNull();
    // 0 (Classic) is a real preset, not a missing one; viem decodes uint8 as a number.
    expect(buildLaunchRow(log({ args: { liquidityPreset: 0 } }), TOTAL_SUPPLY, 1).liquidity_preset).toBe(0);
    expect(buildLaunchRow(log({ args: { liquidityPreset: 3 } }), TOTAL_SUPPLY, 1).liquidity_preset).toBe(3);
  });

  // The start price is per WHOLE token, scaled by 1e18. Dividing by the raw
  // 18-decimal supply instead (or dropping the scale) is an error of 1e18 that
  // would look perfectly plausible sitting in a column of big integers.
  it("derives the start price per whole token × 1e18 from the valuation", () => {
    const row = buildLaunchRow(log(), TOTAL_SUPPLY, 1_700_000_000);
    // 1e18 wei / 1e9 tokens = 1 gwei (1e9 wei) per token, × 1e18
    expect(row.start_fdv).toBe(WAD.toString());
    expect(row.start_price_e18).toBe("1000000000000000000000000000");
    expect(row).not.toHaveProperty("start_price");
  });

  it("keeps values as strings so precision survives", () => {
    const row = buildLaunchRow(log({ args: { startFdv: 999_999_999_999_999_999_999n } }), TOTAL_SUPPLY, 1);
    expect(typeof row.start_fdv).toBe("string");
    expect(row.start_fdv).toBe("999999999999999999999");
    // 999.999…999 gwei per token: the digits a plain wei price floored away survive
    expect(row.start_price_e18).toBe("999999999999999999999000000000");
  });

  it("records an ETH launch's quote as ETH by default", () => {
    const row = buildLaunchRow(log(), TOTAL_SUPPLY, 1);
    expect(row.quote_token).toBe(NATIVE_QUOTE);
    expect(row.quote_symbol).toBe(ETH_QUOTE.symbol);
    expect(row.quote_decimals).toBe(18);
  });

  // A 6-decimal quote: the valuation is in USDC raw units, and the quote's
  // symbol and decimals come from the caller (read once from the token).
  it("records an ERC-20 launch in its quote's raw units", () => {
    const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const row = buildLaunchRow(
      log({ args: { quoteToken: USDC, startFdv: 5_000_000_000n } }), // 5,000 USDC
      TOTAL_SUPPLY,
      1,
      { address: USDC.toLowerCase(), symbol: "USDC", decimals: 6 },
    );
    expect(row.quote_token).toBe(USDC.toLowerCase());
    expect(row.quote_symbol).toBe("USDC");
    expect(row.quote_decimals).toBe(6);
    expect(row.start_fdv).toBe("5000000000");
    expect(row.start_price_e18).toBe("5000000000000000000"); // 5 raw USDC units per whole token, × 1e18
  });

  // The case the e18 scale exists for: 2,500 USDC over 1e9 tokens is 2.5 raw
  // units per token, which an integer of raw units would floor to 2.
  it("keeps a 6-decimal quote's fractional raw units in the start price", () => {
    const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const row = buildLaunchRow(
      log({ args: { quoteToken: USDC, startFdv: 2_500_000_000n } }), // 2,500 USDC
      TOTAL_SUPPLY,
      1,
      { address: USDC.toLowerCase(), symbol: "USDC", decimals: 6 },
    );
    expect(row.start_price_e18).toBe("2500000000000000000"); // 2.5 raw units per whole token
  });

  it("returns a zero start price for a zero supply rather than dividing by zero", () => {
    expect(buildLaunchRow(log(), 0n, 1).start_price_e18).toBe("0");
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

  // No stand-in time: the insert ignores a launch already indexed, so a
  // launched_at of "now" would never be corrected. The caller retries instead.
  it("throws when the block timestamp is unavailable", () => {
    expect(() => buildLaunchRow(log(), TOTAL_SUPPLY, undefined)).toThrow("block time is required");
    expect(() => buildLaunchRow(log(), TOTAL_SUPPLY, null)).toThrow("block time is required");
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
