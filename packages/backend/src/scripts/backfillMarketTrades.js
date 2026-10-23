/**
 * @file backfillMarketTrades.js
 * @description Backfills historical Trade events from InfoFi FPMM contracts
 * Run this to populate infofi_positions table with existing trades
 */

import { infoFiPositionService } from "../services/infoFiPositionService.js";
import { db } from "../../shared/supabaseClient.js";

async function backfillMarketTrades(fpmmAddress, fromBlock = 0n) {
  console.log(`\n🔄 Backfilling trades for market: ${fpmmAddress}`);
  console.log(`   From block: ${fromBlock}\n`);

  // Same path as the market sync route: one infofi_positions row per Trade log,
  // idempotent on (tx_hash, log_index), so a re-run only fills gaps.
  try {
    const result = await infoFiPositionService.syncMarketPositions(fpmmAddress, BigInt(fromBlock));
    if (result.error) return { success: false, error: result.error };
    console.log(
      `   ✅ Recorded: ${result.recorded}  ⏭️  Skipped: ${result.skipped}  ❌ Errors: ${result.errors ?? 0}  📝 Total: ${result.totalEvents}\n`,
    );
    return {
      success: true,
      total: result.totalEvents,
      recorded: result.recorded,
      skipped: result.skipped,
      errors: result.errors ?? 0,
    };
  } catch (error) {
    console.error(`❌ Failed to backfill trades for ${fpmmAddress}:`, error);
    return { success: false, error: error.message };
  }
}

async function backfillAllMarkets() {
  console.log("🚀 Starting backfill of all active market trades...\n");

  try {
    // Get all active FPMM addresses
    const fpmmAddresses = await db.getActiveFpmmAddresses();

    if (!fpmmAddresses || fpmmAddresses.length === 0) {
      console.log("❌ No active markets found");
      return;
    }

    console.log(`Found ${fpmmAddresses.length} active market(s)\n`);

    const results = [];

    for (const fpmmAddress of fpmmAddresses) {
      const result = await backfillMarketTrades(fpmmAddress);
      results.push({ fpmmAddress, ...result });
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 OVERALL BACKFILL SUMMARY");
    console.log("=".repeat(60));

    let totalRecorded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const result of results) {
      if (result.success) {
        totalRecorded += result.recorded || 0;
        totalSkipped += result.skipped || 0;
        totalErrors += result.errors || 0;
      }
    }

    console.log(`Markets processed: ${results.length}`);
    console.log(`Total trades recorded: ${totalRecorded}`);
    console.log(`Total trades skipped: ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log("=".repeat(60) + "\n");

    console.log("✅ Backfill complete!");
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillAllMarkets()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

export { backfillMarketTrades, backfillAllMarkets };
