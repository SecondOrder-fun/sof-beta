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
    name: args.name ?? null,
    symbol: args.symbol ?? null,
    metadata_uri: args.metadataURI || null,
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
