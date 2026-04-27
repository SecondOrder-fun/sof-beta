// Parse CORS_ORIGINS from a comma-separated env value into a list of strings
// and RegExp patterns ready to hand to @fastify/cors.
//
// Format:
//   "https://app.example.com"             -> exact match (trailing slash stripped)
//   "/\.vercel\.app$/"                    -> RegExp('\\.vercel\\.app$')
//   "https://a.com,/preview-.*\.app$/"    -> multiple entries, comma-separated
//
// Validation:
//   - Each entry is trimmed.
//   - Empty entries (e.g. trailing comma) are dropped silently.
//   - String entries must parse as a URL (or be the wildcard "*").
//   - Regex entries must be valid JS RegExp source — invalid patterns throw
//     a single error listing every bad entry, instead of crashing mid-init
//     with whichever bad pattern came first.
//   - Production with no entries is rejected by the caller via the second
//     argument (we return null to signal "no entries"; caller decides).

const REGEX_FLAGS_RE = /^\/(.*)\/([gimsuy]*)$/;

function isValidUrlOrWildcard(value) {
  if (value === "*") return true;
  try {
    const u = new URL(value);
    // Only allow http/https/ws/wss schemes — schemes like javascript: would
    // be a configuration footgun even though @fastify/cors would never use them.
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} envValue Raw CORS_ORIGINS env value.
 * @returns {{ origins: Array<string|RegExp> | null, errors: string[] }}
 *   `origins=null` means the env was unset/blank.
 *   `errors` is non-empty only when entries were present but invalid.
 */
export function parseCorsOrigins(envValue) {
  if (typeof envValue !== "string" || envValue.trim().length === 0) {
    return { origins: null, errors: [] };
  }

  const errors = [];
  const origins = [];

  for (const raw of envValue.split(",")) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    // Regex entry: starts AND ends with `/`. Optional flags allowed
    // (e.g. `/pattern/i`). Bare `/` or `//` is rejected as ambiguous.
    if (trimmed.startsWith("/") && trimmed.length > 2) {
      const match = REGEX_FLAGS_RE.exec(trimmed);
      if (!match) {
        errors.push(`"${trimmed}" looks like a regex but has no closing /`);
        continue;
      }
      const [, pattern, flags] = match;
      if (pattern.length === 0) {
        errors.push(`"${trimmed}" is an empty regex`);
        continue;
      }
      try {
        origins.push(new RegExp(pattern, flags));
      } catch (err) {
        errors.push(`"${trimmed}" is not a valid regex (${err.message})`);
      }
      continue;
    }

    // Plain origin: validate, then strip trailing slash
    if (!isValidUrlOrWildcard(trimmed)) {
      errors.push(
        `"${trimmed}" is not a valid origin (expected http(s)/ws(s) URL or "*")`,
      );
      continue;
    }
    origins.push(trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed);
  }

  return { origins, errors };
}

/**
 * Resolve CORS_ORIGINS into a value @fastify/cors will accept.
 * Throws ONE error listing every bad entry. Throws if the env is missing
 * in production. Returns `true` (allow-all) in non-production when blank.
 *
 * @param {string | undefined} envValue
 * @param {{ isProduction: boolean }} opts
 * @returns {boolean | Array<string|RegExp>}
 */
export function resolveCorsOrigin(envValue, { isProduction }) {
  const { origins, errors } = parseCorsOrigins(envValue);

  if (errors.length > 0) {
    throw new Error(
      `CORS_ORIGINS contains invalid entries:\n${errors
        .map((e) => `  - ${e}`)
        .join("\n")}`,
    );
  }

  if (origins === null || origins.length === 0) {
    if (isProduction) {
      throw new Error(
        "CORS_ORIGINS is required in production. Set a comma-separated allowlist of origins.",
      );
    }
    return true;
  }

  return origins;
}
