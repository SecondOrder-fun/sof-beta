#!/usr/bin/env node
// backend/scripts/migrate-redis-usernames.js
//
// Copies usernames from one Redis to another (Upstash → Railway Redis), keeping
// only EOA wallets. Usernames live nowhere but Redis, so this is the one piece
// of Redis state that has to move; everything else there is cache or TTL'd.
//
// Keys (see shared/usernameService.js):
//   wallet:<lowercase address>    → username (display case)
//   username:<lowercase username> → lowercase address
//
// The forward `wallet:` keys are the source of truth. The reverse `username:`
// keys are rebuilt from them, so a stale reverse key in the source (pointing
// at an address that no longer has that name) is reported and not copied.
//
// An address is dropped as a smart wallet when either:
//   - it has contract code on chain (an EIP-7702 delegation designator,
//     0xef0100 + 20-byte address, does not count: that account is an EOA), or
//   - it is an `sma` in the Supabase smart_accounts table, when SUPABASE_URL and
//     SUPABASE_SERVICE_ROLE_KEY are set and the table still exists. This catches
//     smart accounts that were never deployed, which have no code yet.
//   Run it before `supabase db push` applies the smart_accounts drop.
//
// Usage (dry run by default; nothing is written without --apply):
//   node scripts/migrate-redis-usernames.js --source <redis-url> --target <redis-url>
//   node scripts/migrate-redis-usernames.js --source ... --target ... --apply
//
// Options:
//   --source <url>   source Redis (or SOURCE_REDIS_URL). Only read, never written.
//   --target <url>   target Redis (or TARGET_REDIS_URL).
//   --rpc <url>      chain RPC for the code check (or RPC_URL). Default: Base
//                    Sepolia via the Tenderly gateway.
//   --apply          write to the target. Without it, prints the plan only.
//   --overwrite      replace target keys that already hold a different value,
//                    removing the stale other half of each replaced pair.
//                    Without it those entries are skipped and listed.
//
// Exit code is non-zero if anything failed, or if --apply's read-back of the
// target does not match what was written.

import process from "node:process";
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { createPublicClient, http } from "viem";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const WALLET_PREFIX = "wallet:";
export const USERNAME_PREFIX = "username:";
const DEFAULT_RPC = "https://base-sepolia.gateway.tenderly.co";
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const CODE_CHECK_CONCURRENCY = 10;
const SUPABASE_PAGE = 1000;
// Deletes KEYS[1] only if it still holds ARGV[1] (case-insensitively with ARGV[2] = "ci").
const DEL_IF_EQUALS = `local v = redis.call('GET', KEYS[1])
if v and (v == ARGV[1] or (ARGV[2] == 'ci' and string.lower(v) == string.lower(ARGV[1]))) then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/** True for an account with no code, or only an EIP-7702 delegation designator. */
export function isEoaCode(code) {
  if (!code || code === "0x") return true;
  const hex = code.toLowerCase();
  return hex.startsWith("0xef0100") && hex.length === 2 + 46;
}

/** Hides the password in a redis:// URL so it can be logged. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<unparseable url>";
  }
}

/**
 * Works out what to copy. Pure: takes the source contents and the set of
 * smart-wallet addresses, returns the entries to write and everything skipped.
 *
 * @param {Map<string,string>} wallets  lowercase address → username
 * @param {Map<string,string>} reverse  lowercase username → address
 * @param {Set<string>} smartWallets    lowercase addresses to drop
 */
export function planMigration(wallets, reverse, smartWallets) {
  const keep = [];
  const dropped = [];
  const invalid = [];
  const duplicates = [];
  const byName = new Map();

  for (const [address, username] of wallets) {
    if (!ADDRESS_RE.test(address) || !username) {
      invalid.push({ address, username });
      continue;
    }
    if (smartWallets.has(address)) {
      dropped.push({ address, username });
      continue;
    }
    const name = username.toLowerCase();
    const prior = byName.get(name);
    if (prior) {
      // Two addresses claim one name. The reverse key says who owns it; if it
      // names neither, keep the first and report the other.
      const owner = reverse.get(name)?.toLowerCase();
      const winner = owner === address ? { address, username } : prior;
      const loser = winner === prior ? { address, username } : prior;
      duplicates.push({ ...loser, keptAddress: winner.address });
      byName.set(name, winner);
      continue;
    }
    byName.set(name, { address, username });
  }
  for (const entry of byName.values()) keep.push(entry);

  // Reverse keys that the kept forward keys do not reproduce.
  const staleReverse = [];
  for (const [name, address] of reverse) {
    const kept = byName.get(name);
    const target = String(address).toLowerCase();
    if (kept?.address === target) continue;
    if (dropped.some((d) => d.address === target)) continue;
    staleReverse.push({ username: name, address: target });
  }

  keep.sort((a, b) => a.address.localeCompare(b.address));
  return { keep, dropped, invalid, duplicates, staleReverse };
}

/** Every key-value pair under `prefix`, read with SCAN (never KEYS). */
async function readPrefix(redis, prefix) {
  const out = new Map();
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
    cursor = next;
    if (keys.length === 0) continue;
    const values = await redis.mget(...keys);
    keys.forEach((key, i) => {
      if (values[i] != null) out.set(key.slice(prefix.length).toLowerCase(), values[i]);
    });
  } while (cursor !== "0");
  return out;
}

async function contractAddresses(publicClient, addresses) {
  const contracts = new Set();
  const queue = [...addresses];
  async function worker() {
    while (queue.length > 0) {
      const address = queue.shift();
      const code = await publicClient.getCode({ address });
      if (!isEoaCode(code)) contracts.add(address);
    }
  }
  await Promise.all(Array.from({ length: CODE_CHECK_CONCURRENCY }, worker));
  return contracts;
}

async function smartAccountTableAddresses(log) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    log("smart_accounts: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, using the on-chain check only");
    return new Set();
  }
  const supabase = createSupabaseClient(url, key);
  const smas = new Set();
  for (let from = 0; ; from += SUPABASE_PAGE) {
    const { data, error } = await supabase
      .from("smart_accounts")
      .select("sma")
      .order("sma")
      .range(from, from + SUPABASE_PAGE - 1);
    if (error) {
      // 42P01 (Postgres) / PGRST205 (PostgREST): the table is already dropped.
      if (error.code === "42P01" || error.code === "PGRST205") {
        log("smart_accounts: table not found, using the on-chain check only");
        return new Set();
      }
      throw new Error(`smart_accounts read failed: ${error.message}`);
    }
    for (const row of data) if (row.sma) smas.add(String(row.sma).toLowerCase());
    if (data.length < SUPABASE_PAGE) break;
  }
  log(`smart_accounts: ${smas.size} smart account address(es) loaded`);
  return smas;
}

function parseArgs(argv) {
  const args = { apply: false, overwrite: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--overwrite") args.overwrite = true;
    else if (a === "--source" || a === "--target" || a === "--rpc") {
      if (!argv[i + 1]) throw new Error(`${a} needs a value`);
      args[a.slice(2)] = argv[++i];
    } else throw new Error(`Unknown argument: ${a}`);
  }
  args.source ??= process.env.SOURCE_REDIS_URL;
  args.target ??= process.env.TARGET_REDIS_URL;
  args.rpc ??= process.env.RPC_URL || DEFAULT_RPC;
  if (!args.source || !args.target) {
    throw new Error("Usage: migrate-redis-usernames.js --source <redis-url> --target <redis-url> [--rpc <url>] [--apply] [--overwrite]");
  }
  if (args.source === args.target) throw new Error("--source and --target are the same Redis");
  return args;
}

function connect(url) {
  return new Redis(url, {
    tls: url.startsWith("rediss://") ? {} : undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  log(`source: ${maskUrl(args.source)}`);
  log(`target: ${maskUrl(args.target)}`);
  log(`mode:   ${args.apply ? "APPLY" : "dry run"}${args.overwrite ? " (overwrite)" : ""}\n`);

  const source = connect(args.source);
  const target = connect(args.target);
  try {
    await Promise.all([source.connect(), target.connect()]);

    const wallets = await readPrefix(source, WALLET_PREFIX);
    const reverse = await readPrefix(source, USERNAME_PREFIX);
    log(`source: ${wallets.size} wallet: key(s), ${reverse.size} username: key(s)`);

    const candidates = [...wallets.keys()].filter((a) => ADDRESS_RE.test(a));
    const publicClient = createPublicClient({ transport: http(args.rpc) });
    const onChain = await contractAddresses(publicClient, candidates);
    log(`on chain: ${onChain.size} address(es) with contract code`);
    const fromTable = await smartAccountTableAddresses(log);
    const smartWallets = new Set([...onChain, ...fromTable]);

    const plan = planMigration(wallets, reverse, smartWallets);

    // Target conflicts: a key that already holds something else.
    const conflicts = [];
    const toWrite = [];
    for (const entry of plan.keep) {
      const name = entry.username.toLowerCase();
      const [haveName, haveAddr] = await target.mget(
        `${WALLET_PREFIX}${entry.address}`,
        `${USERNAME_PREFIX}${name}`,
      );
      const clash =
        (haveName != null && haveName !== entry.username) ||
        (haveAddr != null && haveAddr.toLowerCase() !== entry.address);
      if (clash && !args.overwrite) conflicts.push({ ...entry, haveName, haveAddr });
      else toWrite.push({ ...entry, haveName, haveAddr });
    }

    log(`\nkeep (EOA):            ${plan.keep.length}`);
    log(`drop (smart wallet):   ${plan.dropped.length}`);
    for (const d of plan.dropped) log(`  - ${d.address}  ${d.username}`);
    if (plan.invalid.length) {
      log(`invalid (skipped):     ${plan.invalid.length}`);
      for (const d of plan.invalid) log(`  - ${d.address}  ${d.username ?? "<empty>"}`);
    }
    if (plan.duplicates.length) {
      log(`duplicate name:        ${plan.duplicates.length}`);
      for (const d of plan.duplicates) log(`  - ${d.address}  ${d.username}  (kept on ${d.keptAddress})`);
    }
    if (plan.staleReverse.length) {
      log(`stale username: keys:  ${plan.staleReverse.length} (not copied)`);
      for (const d of plan.staleReverse) log(`  - ${d.username} → ${d.address}`);
    }
    if (conflicts.length) {
      log(`target conflicts:      ${conflicts.length} (skipped; --overwrite to replace)`);
      for (const c of conflicts) {
        log(`  - ${c.address}  ${c.username}  (target has wallet:→${c.haveName ?? "-"}, username:→${c.haveAddr ?? "-"})`);
      }
    }
    log(`to write:              ${toWrite.length} wallet(s) = ${toWrite.length * 2} key(s)`);

    if (!args.apply) {
      log("\nDry run: nothing written. Re-run with --apply to copy.");
      return 0;
    }
    if (toWrite.length === 0) {
      log("\nNothing to write.");
      return 0;
    }

    const pipeline = target.pipeline();
    for (const { address, username, haveName, haveAddr } of toWrite) {
      const name = username.toLowerCase();
      // --overwrite: clear the target's other half of each replaced pair, so no
      // old name still points here and no other address still claims this name.
      if (haveName != null && haveName.toLowerCase() !== name) {
        pipeline.eval(DEL_IF_EQUALS, 1, `${USERNAME_PREFIX}${haveName.toLowerCase()}`, address);
      }
      if (haveAddr != null && haveAddr.toLowerCase() !== address) {
        pipeline.eval(DEL_IF_EQUALS, 1, `${WALLET_PREFIX}${haveAddr.toLowerCase()}`, username, "ci");
      }
      pipeline.set(`${WALLET_PREFIX}${address}`, username);
      pipeline.set(`${USERNAME_PREFIX}${name}`, address);
    }
    const results = await pipeline.exec();
    const failed = results.filter(([err]) => err);
    if (failed.length) {
      log(`\n✗ ${failed.length} write(s) failed: ${failed[0][0].message}`);
      return 1;
    }

    // Read every written key back.
    let mismatches = 0;
    for (const { address, username } of toWrite) {
      const [name, addr] = await target.mget(
        `${WALLET_PREFIX}${address}`,
        `${USERNAME_PREFIX}${username.toLowerCase()}`,
      );
      if (name !== username || addr !== address) mismatches++;
    }
    if (mismatches) {
      log(`\n✗ read-back: ${mismatches} wallet(s) do not match what was written`);
      return 1;
    }
    log(`\n✓ wrote and verified ${toWrite.length} wallet(s) (${toWrite.length * 2} keys)`);
    return 0;
  } finally {
    source.disconnect();
    target.disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    },
  );
}
