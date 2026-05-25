/**
 * mountStatus — per-route mount-result registry.
 *
 * server.js records every `app.register()` outcome here at boot. The
 * `/api/health` endpoint reads the failure list so operators (and Railway's
 * probe) can spot partial-mount deploys without waiting for user-visible
 * 404s from the broken route.
 *
 * Critical routes (auth, paymaster/sof, paymaster/local) are expected to
 * re-throw at the call site so boot fails loudly. The registry's only
 * job is to *report* — it doesn't decide criticality.
 *
 * In-memory, singleton scope, no persistence. State is reset at module
 * load and via `_resetMountStatus()` for tests.
 */

/** @type {Map<string, { ok: boolean, critical: boolean, error?: string, at: string }>} */
const _statuses = new Map();

/**
 * Record the outcome of a mount attempt.
 *
 * @param {string} prefix - The URL prefix the route was registered under
 *   (e.g. "/api/auth"). Used as the registry key — re-recording the same
 *   prefix overwrites the prior entry, which is what we want if a retry
 *   wrapper exists in the future.
 * @param {object} opts
 * @param {boolean} opts.ok - true if `app.register()` resolved without throwing.
 * @param {boolean} [opts.critical=false] - whether the caller treats this
 *   route as boot-blocking. Surfaced in the health payload so monitoring
 *   can prioritise critical failures.
 * @param {string} [opts.error] - error message when ok=false.
 */
export function recordMount(prefix, { ok, critical = false, error }) {
  _statuses.set(prefix, {
    ok: Boolean(ok),
    critical: Boolean(critical),
    error: ok ? undefined : (error || "Unknown mount error"),
    at: new Date().toISOString(),
  });
}

/**
 * Snapshot of every recorded mount, in insertion order.
 * @returns {Array<{ prefix: string, ok: boolean, critical: boolean, error?: string, at: string }>}
 */
export function getMountStatus() {
  return Array.from(_statuses.entries()).map(([prefix, info]) => ({
    prefix,
    ...info,
  }));
}

/**
 * Just the failures — what the health endpoint actually reports. Empty
 * array means every recorded mount succeeded.
 *
 * @returns {Array<{ prefix: string, critical: boolean, error: string, at: string }>}
 */
export function getMountFailures() {
  const failures = [];
  for (const [prefix, info] of _statuses.entries()) {
    if (!info.ok) {
      failures.push({
        prefix,
        critical: info.critical,
        error: info.error,
        at: info.at,
      });
    }
  }
  return failures;
}

/**
 * Test-only: clear the registry between cases.
 */
export function _resetMountStatus() {
  _statuses.clear();
}
