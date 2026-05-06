/**
 * airdropService — STUB (Task 5.3)
 *
 * Task 5.4 swaps in the real implementation that does an ERC-20 transfer
 * from BACKEND_WALLET_PRIVATE_KEY to the SMA. Until then this just logs
 * a warning so the auth flow can wire the right shape end-to-end.
 *
 * Contract: getAirdropService(logger) returns an object with
 *   transferToSma(sma): Promise<string|null>
 * matching what smartAccountService.ensureSmartAccount expects.
 */

let _service = null;

/**
 * @param {{warn: Function, info?: Function, error?: Function}} [logger]
 */
export function getAirdropService(logger) {
  if (_service) return _service;
  _service = {
    async transferToSma(sma) {
      logger?.warn?.(
        { sma },
        "airdrop service not yet wired (Task 5.4 lands the real ERC-20 transfer)",
      );
      return null;
    },
  };
  return _service;
}

/** Test/dev hook: clear the cached singleton. */
export function _resetAirdropService() {
  _service = null;
}
