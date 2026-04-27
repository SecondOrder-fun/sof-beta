// Boot-time env validation. Called once from server.js before any listener
// or service initializes — fails loud with the full list of violations
// instead of letting individual call sites discover misconfig at first use.
//
// Two classes of vars are checked:
//   - Always required: SUPABASE/RPC/JWT/wallet basics
//   - Conditional: when NETWORK !== "LOCAL", paymaster + bundler creds also
//     required so sponsored UserOps don't silently 503 on testnet/mainnet
//
// Trimming: all values are stripped of surrounding whitespace in place.
// Catches the trailing-newline-from-shell-pipe bug class that previously
// silently broke CORS_ORIGINS pattern matching.

import { privateKeyToAccount } from "viem/accounts";

const VALID_NETWORKS = ["LOCAL", "TESTNET", "MAINNET"];
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MIN_JWT_SECRET_LEN = 32;

function isUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function trimEnv(env, keys) {
  for (const key of keys) {
    if (typeof env[key] === "string") {
      env[key] = env[key].trim();
    }
  }
}

/**
 * Build the validation manifest. Conditional rules close over `env` so
 * NETWORK can gate downstream requirements.
 */
function buildManifest(env) {
  const network = env.NETWORK || "LOCAL";
  const requireOnNonLocal = network !== "LOCAL";
  const isProduction = env.NODE_ENV === "production";

  return [
    {
      key: "SUPABASE_URL",
      required: true,
      validate: (v) => (isUrl(v) ? null : "must be a valid URL"),
    },
    {
      key: "SUPABASE_SERVICE_ROLE_KEY",
      required: true,
      validate: (v) => (v.length >= 20 ? null : "looks too short to be a JWT"),
    },
    {
      key: "RPC_URL",
      required: true,
      validate: (v) => (isUrl(v) ? null : "must be a valid URL"),
    },
    {
      key: "BACKEND_WALLET_PRIVATE_KEY",
      required: true,
      validate: (v) =>
        PRIVATE_KEY_RE.test(v)
          ? null
          : "must be 0x-prefixed 32-byte hex (66 chars total)",
    },
    {
      key: "BACKEND_WALLET_ADDRESS",
      required: true,
      validate: (v) =>
        ADDRESS_RE.test(v) ? null : "must be a valid 0x-prefixed address",
    },
    {
      key: "JWT_SECRET",
      required: true,
      validate: (v) =>
        v.length >= MIN_JWT_SECRET_LEN
          ? null
          : `must be at least ${MIN_JWT_SECRET_LEN} characters`,
    },
    {
      key: "JWT_EXPIRES_IN",
      required: true,
      // Accept zeit/ms duration strings ("7d", "12h", "30m") or raw seconds.
      // Leading [1-9] forbids zero-duration tokens (e.g. "0" / "0d") that
      // would mint immediately-expired JWTs.
      validate: (v) =>
        /^[1-9]\d*$|^[1-9]\d*\s*[smhdwy]$|^[1-9]\d*\s*(ms|sec|secs|seconds|min|mins|minutes|hour|hours|day|days|week|weeks|year|years)$/i.test(
          v,
        )
          ? null
          : "must be a positive duration like '7d' or a number of seconds",
    },
    {
      key: "NETWORK",
      // Has a default of "LOCAL" applied earlier in this module, so this
      // entry is more of a format check than a presence check.
      required: false,
      validate: (v) =>
        VALID_NETWORKS.includes(v)
          ? null
          : `must be one of ${VALID_NETWORKS.join(", ")}`,
    },
    {
      key: "PAYMASTER_RPC_URL",
      // Always required: PaymasterService.initialize() throws on first
      // airdrop-relay / market-creation call without it. Even on LOCAL,
      // this points at Anvil's RPC (the backend wallet pays its own gas);
      // on TESTNET/MAINNET it points at the Pimlico bundler that
      // sponsors the gas via ERC-4337.
      required: true,
      validate: (v) => (isUrl(v) ? null : "must be a valid URL"),
    },
    {
      key: "PIMLICO_API_KEY",
      required: requireOnNonLocal,
      // Length sanity only — the upstream API will validate the key itself
      validate: (v) => (v.length >= 10 ? null : "looks too short"),
    },
    {
      key: "CORS_ORIGINS",
      // Mirrors the production guard in server.js — surface it at boot
      // instead of mid-initialization after the port is bound.
      required: isProduction,
    },
  ];
}

/**
 * Validate process.env at boot. Throws ONE error listing every violation.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {void}
 * @throws {Error} when any required var is missing/invalid; message lists all
 */
export function assertRequiredEnv(env = process.env) {
  // Apply NETWORK default before manifest is built so conditional rules see it
  if (!env.NETWORK || env.NETWORK.trim() === "") {
    env.NETWORK = "LOCAL";
  }

  const manifest = buildManifest(env);

  // Trim every key referenced in the manifest in place
  trimEnv(
    env,
    manifest.map((m) => m.key),
  );

  const errors = [];

  for (const rule of manifest) {
    const value = env[rule.key];
    const present = typeof value === "string" && value.length > 0;

    if (!present) {
      if (rule.required) {
        errors.push(`${rule.key}: missing (required)`);
      }
      continue;
    }

    if (rule.validate) {
      const validationError = rule.validate(value);
      if (validationError) {
        errors.push(`${rule.key}: ${validationError}`);
      }
    }
  }

  // Cross-check: address must derive from private key. Skip if either
  // already failed above (would produce a noisy duplicate error).
  const keyOk = PRIVATE_KEY_RE.test(env.BACKEND_WALLET_PRIVATE_KEY || "");
  const addrOk = ADDRESS_RE.test(env.BACKEND_WALLET_ADDRESS || "");
  if (keyOk && addrOk) {
    try {
      const derived = privateKeyToAccount(env.BACKEND_WALLET_PRIVATE_KEY)
        .address.toLowerCase();
      const configured = env.BACKEND_WALLET_ADDRESS.toLowerCase();
      if (derived !== configured) {
        errors.push(
          `BACKEND_WALLET_ADDRESS: does not match BACKEND_WALLET_PRIVATE_KEY (expected ${derived}, got ${configured})`,
        );
      }
    } catch (err) {
      errors.push(
        `BACKEND_WALLET_PRIVATE_KEY: failed to derive account (${err.message})`,
      );
    }
  }

  if (errors.length > 0) {
    const lines = [
      "Environment validation failed. Fix the following before starting the server:",
      ...errors.map((e) => `  - ${e}`),
    ];
    throw new Error(lines.join("\n"));
  }
}
