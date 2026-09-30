/**
 * buildLaunchRow
 *
 * Maps a TokenLaunchpad `TokenLaunched` log onto a `token_launches` row.
 *
 * Lives beside tokenLaunchedListener rather than inside it, the same way
 * buildConsolationPoolEvent does: the listener imports viemClient at module
 * load, which throws without NETWORK set, so anything importable for a unit
 * test has to sit outside it. This is also the mapping most likely to break on
 * an ABI change, and it needs neither a chain nor a database to exercise.
 */

/** Whole tokens in a launch supply, used to derive implied FDV. */
const WAD = 10n ** 18n;

/**
 * Text limits applied before insert. The columns are unbounded TEXT; these
 * keep a hostile event from producing a row the database (or the feed) cannot
 * take. Name and symbol match TokenLaunchpad's MAX_NAME_LENGTH /
 * MAX_SYMBOL_LENGTH (bytes there, so no valid launch is ever cut). The
 * metadata URI is not bounded on-chain.
 */
export const MAX_NAME_CHARS = 48;
export const MAX_SYMBOL_CHARS = 16;
export const MAX_METADATA_URI_CHARS = 2048;

/**
 * Make an event string storable: Postgres TEXT cannot hold U+0000 (an insert
 * containing one fails for good, SQLSTATE 22P05), so it is dropped; the result
 * is cut to `max` code points (never inside a surrogate pair). Empty -> null.
 * @param {unknown} value
 * @param {number} max
 */
export function storableText(value, max) {
  if (value == null) return null;
  const chars = Array.from(String(value).replaceAll("\u0000", ""));
  const text = chars.slice(0, max).join("");
  return text === "" ? null : text;
}

/**
 * Turn a TokenLaunched log into a token_launches row.
 *
 * Exported for testing: this is the mapping most likely to break on an ABI
 * change, and it needs no chain or database to exercise.
 *
 * @param {object} log - viem decoded log
 * @param {bigint} totalSupply - TOKEN_SUPPLY, read once at listener start
 * @param {number} [blockTimeSec] - block timestamp; falls back to now
 * @returns {object | null} row, or null if the log is unusable
 */
export function buildLaunchRow(log, totalSupply, blockTimeSec) {
  const args = log?.args;
  if (!args?.token || !args?.creator) return null;

  const startPriceWei = BigInt(args.startPriceWei ?? 0n);
  // Implied FDV is price * WHOLE tokens, not price * raw supply. Getting this
  // wrong is an error of 1e18, which would look plausible in a column of wei.
  const impliedFdvWei = startPriceWei * (BigInt(totalSupply) / WAD);

  return {
    token_address: args.token,
    launch_id: Number(args.launchId ?? 0),
    creator_address: args.creator,
    name: storableText(args.name, MAX_NAME_CHARS),
    symbol: storableText(args.symbol, MAX_SYMBOL_CHARS),
    // An over-long URI is dropped rather than cut: a truncated URI would point
    // somewhere else.
    metadata_uri:
      Array.from(String(args.metadataURI ?? "")).length > MAX_METADATA_URI_CHARS
        ? null
        : storableText(args.metadataURI, MAX_METADATA_URI_CHARS),
    start_price_wei: startPriceWei.toString(),
    implied_fdv_wei: impliedFdvWei.toString(),
    total_supply: BigInt(totalSupply).toString(),
    // bytes32(0) means the placer returned no pool — not a real pool id, so
    // store NULL rather than a zero hash the trade listener would try to match.
    pool_id:
      args.placementId && !/^0x0+$/.test(args.placementId)
        ? args.placementId
        : null,
    launched_at: new Date(
      (blockTimeSec != null ? Number(blockTimeSec) : Math.floor(Date.now() / 1000)) * 1000,
    ).toISOString(),
    block_number: log.blockNumber != null ? Number(log.blockNumber) : null,
    tx_hash: log.transactionHash ?? null,
  };
}
