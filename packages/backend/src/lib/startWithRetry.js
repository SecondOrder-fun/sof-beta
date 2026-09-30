/**
 * startWithRetry
 *
 * Starts a long-lived listener, retrying a failed start with bounded
 * exponential backoff (5s, 10s, 20s … capped at 5 min) for as long as it
 * takes. A listener's start reads the chain and the database; one transient
 * failure there must not leave it stopped until the next deploy, and must not
 * crash the server either — failures are logged, never thrown.
 *
 * Returns a stop function for the shutdown gather. It cancels a pending
 * retry, waits out an attempt in flight (stopping the listener that attempt
 * starts), and stops a listener already running.
 */

export const START_RETRY_BASE_MS = 5_000;
export const START_RETRY_MAX_MS = 5 * 60_000;

/**
 * Delay before retry number `attempt` (1-based): base * 2^(attempt-1), capped.
 * @param {number} attempt
 * @param {{ baseMs?: number, maxMs?: number }} [opts]
 */
export function startRetryDelayMs(attempt, { baseMs = START_RETRY_BASE_MS, maxMs = START_RETRY_MAX_MS } = {}) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/**
 * @param {object} p
 * @param {string} p.label  for logs, e.g. "LaunchTradeListener"
 * @param {() => Promise<(() => Promise<void> | void)>} p.start  resolves to the listener's stop function
 * @param {{ info: Function, error: Function }} p.logger
 * @param {number} [p.baseMs]
 * @param {number} [p.maxMs]
 * @param {(fn: () => void, ms: number) => unknown} [p.setTimer]  test seam
 * @param {(handle: unknown) => void} [p.clearTimer]  test seam
 * @returns {{ stop: () => Promise<void>, ready: Promise<void> }} `ready` settles
 *   after the first attempt (started, or a retry scheduled); it never rejects
 */
export function startWithRetry({
  label,
  start,
  logger,
  baseMs = START_RETRY_BASE_MS,
  maxMs = START_RETRY_MAX_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let stopped = false;
  let failures = 0;
  let timer = null;
  let unwatch = null;
  let attemptInFlight = /** @type {Promise<void> | null} */ (null);

  const attempt = async () => {
    timer = null;
    if (stopped) return;
    let fn;
    try {
      fn = await start();
    } catch (err) {
      if (stopped) return;
      failures += 1;
      const delay = startRetryDelayMs(failures, { baseMs, maxMs });
      logger.error(
        `❌ Failed to start ${label} (attempt ${failures}): ${err?.message ?? err} — retrying in ${Math.round(delay / 1000)}s`,
      );
      timer = setTimer(run, delay);
      return;
    }
    if (stopped) {
      // Shutdown began while this attempt was starting: stop what it started.
      try {
        if (typeof fn === "function") await fn();
      } catch (err) {
        logger.error(`❌ Failed to stop ${label}: ${err?.message ?? err}`);
      }
      return;
    }
    unwatch = fn;
    logger.info(`✅ ${label} started${failures ? ` after ${failures} failed attempt(s)` : ""}`);
  };

  function run() {
    attemptInFlight = attempt().finally(() => {
      attemptInFlight = null;
    });
    return attemptInFlight;
  }

  const ready = run();

  return {
    ready,
    async stop() {
      stopped = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (attemptInFlight) await attemptInFlight;
      const fn = unwatch;
      unwatch = null;
      if (typeof fn === "function") await fn();
    },
  };
}
