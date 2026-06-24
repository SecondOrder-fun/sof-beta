import fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import process from "node:process";
import { hasSupabase, db } from "../shared/supabaseClient.js";
import { startSeasonStartedListener } from "../src/listeners/seasonStartedListener.js";
import { startSeasonCompletedListener } from "../src/listeners/seasonCompletedListener.js";
import { startSeasonStatusListener } from "../src/listeners/seasonStatusListener.js";
import { startSeasonLifecycleService, getSeasonLifecycleService } from "../src/services/seasonLifecycleService.js";
import { startPositionUpdateListener } from "../src/listeners/positionUpdateListener.js";
import { startMarketCreatedListener } from "../src/listeners/marketCreatedListener.js";
import { startTradeListener } from "../src/listeners/tradeListener.js";
import { startSponsorHatListener } from "../src/listeners/sponsorHatListener.js";
import { startRolloverEventListener } from "../src/listeners/rolloverEventListener.js";
import { startAccountCreatedListener } from "../src/listeners/accountCreatedListener.js";
import { getDeployment } from "@sof/contracts/deployments";
import { infoFiPositionService } from "../src/services/infoFiPositionService.js";
import { historicalOddsService } from "../shared/historicalOddsService.js";
import { RaffleABI as raffleAbi, SOFBondingCurveABI as sofBondingCurveAbi, InfoFiMarketFactoryABI as infoFiMarketFactoryAbi, SimpleFPMMABI as simpleFpmmAbi } from '@sof/contracts';
import { getChainByKey } from "../src/config/chain.js";
import { authenticateFastify } from "../shared/auth.js";
import { resolveCorsOrigin } from "../shared/parseCorsOrigins.js";
import { recordMount } from "../shared/mountStatus.js";

// NOTE: env validation happens BEFORE this module loads, in fastify/boot.js.
// Putting the assert here would fire too late — ESM hoists transitive imports
// (e.g. viemClient → chain) which throw on missing RPC_URL before any
// top-level code runs.

// Create Fastify instance
// 1 MiB request body cap — well above any real payload (signatures batch,
// admin forms) but blocks accidental or hostile large bodies before handlers run.
const app = fastify({ logger: true, bodyLimit: 1_048_576 });

// Attach JWT authentication parsing (public endpoints still allowed)
await authenticateFastify(app);

// Select network ("LOCAL" or "TESTNET") for on-chain listeners
// Respect NETWORK from .env, with LOCAL as final fallback
const NETWORK = process.env.NETWORK || "LOCAL";
app.log.info({ NETWORK }, "Using backend network configuration");

// Log Supabase connection status at startup
if (hasSupabase) {
  app.log.info("✅ Supabase configured and connected");
} else {
  app.log.warn("⚠️  Supabase NOT configured - database operations will fail");
  app.log.warn("    Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
}

// Register plugins
//
// CORS origins are parsed via shared/parseCorsOrigins.js so bad regex
// patterns surface a clear, all-at-once error instead of `new RegExp()`
// crashing mid-initialization.
const corsOrigin = resolveCorsOrigin(process.env.CORS_ORIGINS, {
  isProduction: process.env.NODE_ENV === "production",
});

await app.register(cors, {
  origin: corsOrigin,
  credentials: true,
});

await app.register(helmet);

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// Log every route as it is registered to diagnose mounting issues
app.addHook("onRoute", (routeOptions) => {
  try {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method.join(",")
      : routeOptions.method;
    app.log.info(
      { method: methods, url: routeOptions.url, prefix: routeOptions.prefix },
      "route added",
    );
  } catch (e) {
    app.log.error({ e }, "Failed to log route");
  }
});

/**
 * Mount a route module. Records the outcome in the shared mountStatus
 * registry so `/api/health` can report partial-mount deploys. Critical
 * routes re-throw on failure — the boot process exits non-zero rather
 * than push the broken state downstream to user 404s. See Issue #102 /
 * followup_env_validator_failfast.
 *
 * Non-critical routes (admin diagnostics, optional integrations) keep
 * the swallow-and-log behaviour so a single broken module doesn't take
 * the whole server down.
 *
 * @param {string} key - Registry key + log label. Usually equals the
 *   URL prefix; the `/api/access` triplet uses disambiguated keys (e.g.
 *   "/api/access (groups)") since three modules share one prefix.
 * @param {() => Promise<{default: Function}>} importer - dynamic-import
 *   thunk; we run it inside the try so module-load throws also count.
 * @param {object} [opts]
 * @param {boolean} [opts.critical=false] - re-throw on failure if true
 * @param {string} [opts.prefix] - URL prefix passed to app.register
 *   (defaults to `key`).
 * @param {object} [opts.registerOptions] - extra options merged into the
 *   register() call (e.g. injecting a shared client).
 */
async function mountRoute(key, importer, opts = {}) {
  const { critical = false, prefix = key, registerOptions } = opts;
  try {
    const mod = await importer();
    await app.register(mod.default, { prefix, ...(registerOptions || {}) });
    recordMount(key, { ok: true, critical });
    app.log.info(`Mounted ${key}`);
  } catch (err) {
    recordMount(key, {
      ok: false,
      critical,
      error: err?.message || String(err),
    });
    app.log.error({ err, key, critical }, `Failed to mount ${key}`);
    if (critical) {
      // Re-throw so the top-level await unwinds and boot.js' catch fires
      // a process.exit(1). Silent partial-mount deploys are the bug
      // Issue #102 closes.
      throw err;
    }
  }
}

// ── Route mounts ────────────────────────────────────────────────────
//
// Critical mounts (auth, paymaster/sof, paymaster/local) re-throw on
// failure so a misconfigured deploy fails loudly at boot instead of
// silently 404ing routes at request time. Everything else logs and
// continues so a single broken diagnostic doesn't take down the
// platform.

await mountRoute("/api", () => import("./routes/healthRoutes.js"));
await mountRoute("/api", () => import("./routes/farcasterWebhookRoutes.js"));
await mountRoute("/api/usernames", () => import("./routes/usernameRoutes.js"));
await mountRoute("/api/users", () => import("./routes/userRoutes.js"));
await mountRoute("/api/infofi", () => import("./routes/infoFiRoutes.js"));
await mountRoute("/api/admin", () => import("./routes/adminRoutes.js"));
await mountRoute("/api/raffle", () => import("./routes/raffleTransactionRoutes.js"));
await mountRoute("/api/allowlist", () => import("./routes/allowlistRoutes.js"));
await mountRoute("/api/nft-drops", () => import("./routes/nftDropRoutes.js"));

// CRITICAL: auth/verify failure means nobody can sign in.
await mountRoute("/api/auth", () => import("./routes/authRoutes.js"), {
  critical: true,
});

// /api/access is split across three modules (access, groups,
// route-config) for historical reasons; each gets its own registry
// entry under a disambiguated key so a partial mount is observable.
await mountRoute("/api/access", () => import("./routes/accessRoutes.js"));
await mountRoute("/api/access (groups)", () => import("./routes/groupRoutes.js"), {
  prefix: "/api/access",
});
await mountRoute(
  "/api/access (route-config)",
  () => import("./routes/routeConfigRoutes.js"),
  { prefix: "/api/access" },
);

await mountRoute("/api/seasons", () => import("./routes/seasonRoutes.js"));
await mountRoute("/api/gating", () => import("./routes/gatingRoutes.js"));
await mountRoute("/api/airdrop", () => import("./routes/airdropRoutes.js"));
await mountRoute("/api/paymaster", () => import("./routes/paymasterProxyRoutes.js"));

// CRITICAL: paymaster/local is the local-dev gasless rail; mount
// failure there means LOCAL deploys can't submit UserOps.
await mountRoute("/api/paymaster/local", () => import("./routes/localBundlerRoutes.js"), {
  critical: true,
});

// CRITICAL: paymaster/sof is the ERC-7677 paymaster signing service.
// Mount errors historically came from pickChain() throwing on missing
// RPC envs (PR #74 incident) — exactly the silent-404 pattern this
// followup closes.
await mountRoute("/api/paymaster/sof", () => import("./routes/paymasterServiceRoutes.js"), {
  critical: true,
});

await mountRoute("/api/wallet", () => import("./routes/delegationRoutes.js"));
await mountRoute("/api/rollover", () => import("./routes/rolloverRoutes.js"));
await mountRoute("/sse", () => import("./routes/sseRoutes.js"));
await mountRoute("/api/curve", () => import("./routes/curveRoutes.js"));

// Build the Blockscout client up-front so multiple routes (the proxy
// itself + /api/token/sof/transactions/:user) can share one instance
// with its LRU cache and endpoint whitelist. Null when not configured;
// routes that need it return 503 rather than crashing.
let sharedBlockscoutClient = null;
if (process.env.BLOCKSCOUT_BASE_URL && process.env.BLOCKSCOUT_API_KEY) {
  try {
    const { createBlockscoutClient } = await import(
      "../src/services/blockscoutClient.js"
    );
    sharedBlockscoutClient = createBlockscoutClient({
      baseUrl: process.env.BLOCKSCOUT_BASE_URL,
      apiKey: process.env.BLOCKSCOUT_API_KEY,
      logger: app.log,
    });
  } catch (err) {
    app.log.error({ err }, "Failed to initialize Blockscout client");
  }
} else {
  app.log.warn("⚠️  BLOCKSCOUT_BASE_URL/API_KEY missing; cold reads disabled");
}

await mountRoute("/api/token", () => import("./routes/tokenRoutes.js"), {
  registerOptions: { blockscoutClient: sharedBlockscoutClient },
});
await mountRoute("/api/chain", () => import("./routes/chainTimeRoutes.js"));

if (sharedBlockscoutClient) {
  await mountRoute(
    "/api/blockscout",
    () => import("./routes/blockscoutRoutes.js"),
    { registerOptions: { blockscoutClient: sharedBlockscoutClient } },
  );
}

// Debug: print all mounted routes
// app.ready(() => {
//   try {
//     app.log.info("Route tree start");
//     app.log.info("\n" + app.printRoutes());
//     app.log.info("Route tree end");
//   } catch (e) {
//     app.log.error({ e }, "Failed to print routes");
//   }
// });

// Error handling
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.status(500).send({ error: "Internal Server Error" });
});

// 404 handler
app.setNotFoundHandler((_request, reply) => {
  reply.status(404).send({ error: "Not Found" });
});

// Initialize listeners
let unwatchSeasonStarted;
let unwatchSeasonCompleted;
let unwatchSeasonStatusListeners = []; // array returned by startSeasonStatusListener
let unwatchMarketCreated;
let unwatchRollover;
let unwatchAccountCreated;
const positionUpdateListeners = new Map(); // Map of seasonId -> unwatch function
const tradeListeners = new Map(); // Map of fpmmAddress -> unwatch function
let stopSharedHead; // halts the shared chain-head tracker on shutdown

async function startListeners() {
  try {
    const chain = getChainByKey(NETWORK);
    const raffleAddress = chain.raffle;

    const infoFiFactoryAddress = chain.infofiFactory;

    // Start the shared chain-head tracker BEFORE any listener. Each listener's
    // contractEventPolling reads the cached head instead of issuing its own
    // getBlockNumber + getBlock pair every tick — collapsing the per-listener
    // RPC volume that was tripping Tenderly's rate limit. Must run before the
    // first startContractEventPolling call, which binds to the tracker once.
    try {
      const { registerSharedHead } = await import("../src/lib/blockHead.js");
      const { publicClient } = await import("../src/lib/viemClient.js");
      const headTracker = registerSharedHead(publicClient, {
        intervalMs: 4_000,
      });
      headTracker.start();
      stopSharedHead = () => headTracker.stop();
    } catch (err) {
      app.log.error({ err }, "Failed to start shared chain-head tracker");
    }

    // Warm the SOF metadata cache so /api/token/sof serves immediately.
    // One chain read at boot replaces a per-mount eth_call from every
    // frontend page that needs sofDecimals (raffle list, raffle detail,
    // profile, sponsor, etc.).
    try {
      const { fetchSofMetadata } = await import("../src/lib/sofMetadataCache.js");
      const { publicClient } = await import("../src/lib/viemClient.js");
      await fetchSofMetadata({ publicClient, network: NETWORK, logger: app.log });
    } catch (err) {
      app.log.error({ err }, "Failed to fetch SOF metadata at startup");
    }

    if (!raffleAddress) {
      app.log.warn(
        `⚠️  Raffle address env not set for NETWORK=${NETWORK} - SeasonStarted listener will not start`,
      );
      return;
    }

    // Callback to start PositionUpdate listener when a season starts
    const onSeasonCreated = async (seasonData) => {
      const { seasonId, bondingCurveAddress, raffleTokenAddress } = seasonData;

      try {
        app.log.info(
          `🎧 Starting PositionUpdate listener for season ${seasonId}`,
        );

        const unwatch = await startPositionUpdateListener(
          bondingCurveAddress,
          sofBondingCurveAbi,
          raffleAddress,
          raffleAbi,
          raffleTokenAddress,
          infoFiFactoryAddress,
          app.log,
        );

        // Store unwatch function for cleanup
        positionUpdateListeners.set(seasonId, unwatch);
        app.log.info(
          `✅ PositionUpdate listener started for season ${seasonId}`,
        );
      } catch (error) {
        app.log.error(
          `❌ Failed to start PositionUpdate listener for season ${seasonId}: ${error.message}`,
        );
      }
    };

    // Discover existing seasons and start listeners for them
    if (hasSupabase) {
      try {
        app.log.info("🔍 Discovering existing seasons...");
        const existingSeasons = await db.getActiveSeasonContracts();

        if (existingSeasons && existingSeasons.length > 0) {
          app.log.info(`Found ${existingSeasons.length} active season(s)`);

          for (const season of existingSeasons) {
            await onSeasonCreated({
              seasonId: season.season_id,
              bondingCurveAddress: season.bonding_curve_address,
              raffleTokenAddress: season.raffle_token_address,
            });
          }
        } else {
          app.log.info("No existing seasons found");
        }
      } catch (error) {
        app.log.error(`Failed to discover existing seasons: ${error.message}`);
      }
    }

    // Start SeasonStarted listener (which will trigger PositionUpdate listeners)
    unwatchSeasonStarted = await startSeasonStartedListener(
      raffleAddress,
      raffleAbi,
      app.log,
      onSeasonCreated,
    );

    // Start SeasonStatus listener (handles SeasonCreated, SeasonLocked,
    // SeasonEndRequested, SeasonReadyToFinalize, SeasonCancelled)
    try {
      unwatchSeasonStatusListeners = await startSeasonStatusListener(
        raffleAddress,
        raffleAbi,
        app.log,
      );
      app.log.info("✅ SeasonStatusListener started (5 events)");
    } catch (error) {
      app.log.error(`❌ Failed to start SeasonStatusListener: ${error.message}`);
    }

    // Callback to clean up per-season listeners when a season completes.
    // Unwatch fns are now async — they await blockCursor.flush() before
    // resolving — so we must await them here, otherwise the flush is
    // orphaned outside the shutdown gather and a SIGTERM landing during
    // this callback could kill the HTTP UPSERT in flight.
    const onSeasonCompleted = async ({ seasonId }) => {
      // Stop the PositionUpdate listener for this season
      const posUnwatch = positionUpdateListeners.get(seasonId);
      if (posUnwatch) {
        await posUnwatch();
        positionUpdateListeners.delete(seasonId);
        app.log.info(
          `🛑 Stopped PositionUpdate listener for completed season ${seasonId}`,
        );
      }

      // Stop any Trade listeners associated with this season's markets.
      // Each tradeUnwatch awaits a Supabase UPSERT (the cursor flush), so
      // a season with N markets would otherwise serialize N × flush
      // latency before this callback returns — blocking the upstream
      // SeasonCompleted tick. Fan out via Promise.allSettled so a slow
      // flush on one market doesn't starve the others or the broader
      // event loop. Mirrors the rolloverEventListener.unwatchAll pattern.
      try {
        const markets = await db.getInfoFiMarketsBySeasonId(seasonId);
        if (markets && markets.length > 0) {
          const stops = [];
          for (const market of markets) {
            const addr = market.contract_address;
            if (!addr) continue;
            const tradeUnwatch = tradeListeners.get(addr);
            if (!tradeUnwatch) continue;
            tradeListeners.delete(addr);
            stops.push(
              tradeUnwatch().then(
                () => {
                  app.log.info(
                    `🛑 Stopped Trade listener for FPMM ${addr} (season ${seasonId})`,
                  );
                },
                (err) => {
                  app.log.error(
                    { err },
                    `Error stopping Trade listener for FPMM ${addr} (season ${seasonId})`,
                  );
                },
              ),
            );
          }
          await Promise.allSettled(stops);
        }
      } catch (error) {
        app.log.error(
          `❌ Error cleaning up Trade listeners for season ${seasonId}: ${error.message}`,
        );
      }
    };

    // Start SeasonCompleted listener (marks seasons as inactive when they end)
    unwatchSeasonCompleted = await startSeasonCompletedListener(
      raffleAddress,
      raffleAbi,
      app.log,
      onSeasonCompleted,
    );

    // Resolve InfoFi factory address based on NETWORK (already computed above)
    if (infoFiFactoryAddress) {
      try {
        app.log.info("🎧 Starting MarketCreated listener...");
        unwatchMarketCreated = await startMarketCreatedListener(
          infoFiFactoryAddress,
          infoFiMarketFactoryAbi,
          app.log,
        );
        app.log.info("✅ MarketCreated listener started");
      } catch (error) {
        app.log.error(
          `❌ Failed to start MarketCreated listener: ${error.message}`,
        );
      }
    } else {
      // No InfoFi factory configured for this environment; skip listener entirely
      app.log.error(
        "No INFOFI_MARKET_FACTORY contract configured (INFOFI_FACTORY_ADDRESS_" +
          (NETWORK === "TESTNET" ? "TESTNET" : "LOCAL") +
          ") - MarketCreated listener will not start",
      );
    }

    // Start Trade listeners for FPMM contracts
    // Get list of active FPMM addresses from database
    if (hasSupabase) {
      try {
        app.log.info("🎧 Starting Trade listeners for FPMM contracts...");
        const activeFpmmAddresses = await db.getActiveFpmmAddresses();

        if (activeFpmmAddresses && activeFpmmAddresses.length > 0) {
          app.log.info(
            `Found ${activeFpmmAddresses.length} active FPMM contract(s)`,
          );

          const unwatchFunctions = await startTradeListener(
            activeFpmmAddresses,
            simpleFpmmAbi,
            app.log,
          );

          // Store unwatch functions for cleanup
          unwatchFunctions.forEach((unwatch, index) => {
            tradeListeners.set(activeFpmmAddresses[index], unwatch);
          });

          app.log.info(
            `✅ Trade listeners started for ${activeFpmmAddresses.length} FPMM contract(s)`,
          );
        } else {
          app.log.info(
            "No active FPMM contracts found - Trade listeners not started",
          );
        }
      } catch (error) {
        app.log.error(`❌ Failed to start Trade listeners: ${error.message}`);
      }
    }

    // Start Season Lifecycle Service (auto start/end seasons on schedule)
    if (raffleAddress) {
      try {
        const lifecycleIntervalMs = process.env.SEASON_LIFECYCLE_INTERVAL_MS
          ? parseInt(process.env.SEASON_LIFECYCLE_INTERVAL_MS)
          : 5 * 60 * 1000; // Default 5 minutes

        await startSeasonLifecycleService(
          raffleAddress,
          app.log,
          lifecycleIntervalMs
        );
        app.log.info("✅ SeasonLifecycleService started");
      } catch (error) {
        app.log.error(
          `❌ Failed to start SeasonLifecycleService: ${error.message}`
        );
      }
    }

    // Start Sponsor Hat auto-minter (watches StakingEligibility and mints hats)
    try {
      await startSponsorHatListener();
      app.log.info("✅ SponsorHatListener started");
    } catch (error) {
      app.log.error(
        `❌ Failed to start SponsorHatListener: ${error.message}`
      );
    }

    // Start Rollover Event Listener (indexes RolloverEscrow events).
    // startRolloverEventListener is async — without await, unwatchRollover
    // would hold the Promise (not the unwatchAll fn) and shutdown would
    // throw `TypeError: unwatchRollover is not a function`, leaving the 3
    // rollover cursors un-flushed on every deploy.
    try {
      unwatchRollover = await startRolloverEventListener(NETWORK, app.log);
      app.log.info("✅ RolloverEventListener started");
    } catch (error) {
      app.log.error(
        `❌ Failed to start RolloverEventListener: ${error.message}`
      );
    }

    // Start AccountCreated listener — stamps smart_accounts.deployed_at
    // when SOFSmartAccountFactory deploys an SMA via UserOp initCode.
    // Per gasless-rewrite spec §5.5.
    try {
      const factoryAddress =
        getDeployment(NETWORK.toLowerCase()).SOFSmartAccountFactory;
      if (
        factoryAddress &&
        factoryAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        unwatchAccountCreated = await startAccountCreatedListener(
          factoryAddress,
          app.log,
        );
        app.log.info("✅ AccountCreatedListener started");
      } else {
        app.log.warn(
          "⚠️  SOFSmartAccountFactory not in deployments — AccountCreated listener skipped",
        );
      }
    } catch (error) {
      app.log.error(
        `❌ Failed to start AccountCreatedListener: ${error.message}`,
      );
    }
  } catch (error) {
    app.log.error("Failed to start listeners:", error);
    // Don't crash server, but log the error
  }
}

/**
 * Sync historical positions for all active markets
 * Runs on server startup to catch any missed trades
 */
async function syncHistoricalPositions() {
  try {
    app.log.info("🔄 Starting historical position sync...");

    const result = await infoFiPositionService.syncAllActiveMarkets();

    if (result.success) {
      if (result.message) {
        app.log.info(`✅ Historical sync: ${result.message}`);
      } else {
        app.log.info(
          `✅ Historical sync complete: ${result.totalRecorded ?? 0} new positions recorded, ` +
            `${result.totalSkipped ?? 0} already synced, ${result.totalErrors ?? 0} errors`,
        );
      }

      if (result.details && result.details.length > 0) {
        app.log.debug({ markets: result.details }, "Sync details by market");
      }
    } else {
      app.log.warn("⚠️  Historical sync completed with issues");
    }
  } catch (error) {
    app.log.error("Failed to sync historical positions:", error);
    // Don't crash server, but log the error
  }
}

/**
 * Seed initial odds data points for all active markets
 * Ensures charts have at least one data point even before trades happen
 */
async function seedInitialOddsHistory() {
  try {
    app.log.info("📊 Seeding initial odds history for active markets...");

    const { data: markets, error } = await db.client
      .from("infofi_markets")
      .select("id, season_id, current_probability_bps")
      .eq("is_active", true);

    if (error) {
      app.log.error(`Failed to fetch markets for odds seeding: ${error.message}`);
      return;
    }

    if (!markets || markets.length === 0) {
      app.log.info("No active markets to seed odds for");
      return;
    }

    let seeded = 0;
    for (const market of markets) {
      try {
        const seasonId = market.season_id ?? 0;
        const probBps = market.current_probability_bps ?? 5000;

        // Check if there are already data points
        const stats = await historicalOddsService.getStats(seasonId, market.id);
        if (stats.count > 0) {
          continue; // Already has data, skip
        }

        await historicalOddsService.recordOddsUpdate(seasonId, market.id, {
          timestamp: Date.now(),
          yes_bps: probBps,
          no_bps: 10000 - probBps,
          hybrid_bps: probBps,
          raffle_bps: 0,
          sentiment_bps: 0,
        });
        seeded++;
      } catch (seedError) {
        app.log.warn(`Failed to seed odds for market ${market.id}: ${seedError.message}`);
      }
    }

    app.log.info(`✅ Seeded odds history for ${seeded} market(s) (${markets.length} total active)`);
  } catch (error) {
    app.log.error(`Failed to seed odds history: ${error.message}`);
  }
}

// Start server
const PORT = process.env.PORT || 3000;

try {
  //await app.listen({ port: Number(PORT), host: "127.0.0.1" });
  await app.listen({ port: Number(PORT), host: "0.0.0.0" });
  app.log.info(`🚀 Server listening on port ${PORT}`);

  // Start listeners in background (non-blocking)
  // This prevents slow listener initialization from blocking server readiness
  startListeners().catch((err) => {
    app.log.error({ err }, "Failed to start listeners");
  });

  // Sync historical positions in background (non-blocking)
  syncHistoricalPositions().catch((err) => {
    app.log.error({ err }, "Failed to sync historical positions");
  });

  // Seed initial odds history for charts (non-blocking)
  seedInitialOddsHistory().catch((err) => {
    app.log.error({ err }, "Failed to seed initial odds history");
  });

  app.log.info("✅ Server ready - listeners and sync starting in background");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
let isShuttingDown = false;
// 15s budget covers ~13 parallel cursor flushes against Supabase
// (each is a single UPSERT) plus app.close(). The old 8s budget assumed
// fire-and-forget stops; awaiting flushes now needs more headroom for
// the case where Supabase is slow but recoverable.
const SHUTDOWN_HARD_TIMEOUT_MS = 15_000;

// Each cleanup step gets its own try/catch — one failing listener (e.g. an
// onClose hook throwing because Anvil is already down) must not abort the
// remaining steps. Pino logs Error instances under the `err` key, not `error`,
// so use that shape for visibility instead of the empty `{}` we used to log.
//
// Listener stop functions are async (they wait for the cursor flush to
// land in Supabase before resolving), so safeStep awaits `fn()` and the
// caller is expected to collect the returned Promise and await it via
// Promise.allSettled. Sync stop fns are still supported — `await fn()`
// is a no-op on undefined.
async function safeStep(label, fn) {
  try {
    await fn();
    app.log.info(`Stopped ${label}`);
  } catch (err) {
    app.log.error({ err }, `Error stopping ${label}`);
  }
}

async function shutdown(signal) {
  if (isShuttingDown) {
    app.log.warn(`Shutdown already in progress, ignoring duplicate ${signal}`);
    return;
  }

  isShuttingDown = true;
  app.log.info(`${signal} received — shutting down server...`);

  // Watchdog: if any close hook hangs (e.g. Redis client awaiting a reply that
  // never comes because the server is gone), force-exit. Without this,
  // `local-dev.sh stop` had to fall back to SIGKILL and listeners never got
  // their last persisted cursor write.
  const watchdog = setTimeout(() => {
    app.log.error(
      `Shutdown exceeded ${SHUTDOWN_HARD_TIMEOUT_MS}ms — forcing exit`,
    );
    process.exit(1);
  }, SHUTDOWN_HARD_TIMEOUT_MS);
  watchdog.unref();

  // Run all listener stops in parallel and AWAIT them. Each stop awaits
  // its cursor's flush() so we get one final Supabase UPSERT per cursor
  // before app.close() / process.exit. Without this gather, the previous
  // fire-and-forget pattern dropped up to throttleMs (30s) of cursor
  // progress on every deploy.
  const stops = [];
  if (unwatchSeasonStarted)
    stops.push(safeStep("SeasonStarted listener", unwatchSeasonStarted));
  if (unwatchSeasonCompleted)
    stops.push(safeStep("SeasonCompleted listener", unwatchSeasonCompleted));
  for (const [i, unwatch] of unwatchSeasonStatusListeners.entries()) {
    stops.push(safeStep(`SeasonStatus listener[${i}]`, unwatch));
  }
  if (unwatchMarketCreated)
    stops.push(safeStep("MarketCreated listener", unwatchMarketCreated));
  if (unwatchRollover) stops.push(safeStep("Rollover listener", unwatchRollover));
  if (unwatchAccountCreated)
    stops.push(safeStep("AccountCreated listener", unwatchAccountCreated));

  for (const [seasonId, unwatch] of positionUpdateListeners.entries()) {
    stops.push(
      safeStep(`PositionUpdate listener for season ${seasonId}`, unwatch),
    );
  }

  for (const [fpmmAddress, unwatch] of tradeListeners.entries()) {
    stops.push(safeStep(`Trade listener for FPMM ${fpmmAddress}`, unwatch));
  }

  if (stopSharedHead)
    stops.push(safeStep("Shared chain-head tracker", stopSharedHead));

  await Promise.allSettled(stops);

  try {
    const lifecycleService = getSeasonLifecycleService(app.log);
    lifecycleService.stop();
  } catch {
    // Service may not have been started
  }

  try {
    await app.close();
    app.log.info("Server shut down gracefully");
  } catch (err) {
    app.log.error({ err }, "Error during app.close()");
  }

  clearTimeout(watchdog);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { app };
