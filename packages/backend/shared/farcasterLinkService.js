/**
 * farcasterLinkService — DB operations for attaching/detaching a Farcaster
 * identity (fid, username) to a wallet's allowlist_entries row.
 *
 * Used by /api/auth/link-farcaster, /api/auth/unlink-farcaster, and the
 * wallet branch of /api/auth/verify (lookup only).
 *
 * Spec: docs/superpowers/specs/2026-05-20-farcaster-link-semantic-design.md
 */
import { db, hasSupabase } from "./supabaseClient.js";

/**
 * Look up the FID currently linked to a given wallet address.
 * Returns { fid, username, displayName } or null.
 */
export async function getLinkedFidForWallet(walletAddress) {
  if (!hasSupabase || !walletAddress) return null;
  const addr = walletAddress.toLowerCase();

  const { data } = await db.client
    .from("allowlist_entries")
    .select("fid, username, display_name")
    .eq("wallet_address", addr)
    .eq("is_active", true)
    .single();

  if (!data || data.fid == null) return null;
  return {
    fid: data.fid,
    username: data.username || null,
    displayName: data.display_name || null,
  };
}

/**
 * Attach `fid` (with username, displayName) to `walletAddress`.
 *
 * Handles the three cases described in the spec:
 *   1. No conflict — insert/update the wallet's row.
 *   2. Self-link — refresh username/display_name on existing row.
 *   3. Cross-wallet conflict — clear FID columns on the loser's row
 *      (or delete the row if it has no wallet_address), then write the
 *      new row.
 *
 * Returns { success: true, entry } on success, { success: false, error } on failure.
 */
export async function linkFarcasterToWallet({
  walletAddress,
  fid,
  username,
  displayName,
}) {
  if (!hasSupabase) return { success: false, error: "Database not configured" };
  if (!walletAddress || !fid) {
    return { success: false, error: "walletAddress and fid are required" };
  }

  const addr = walletAddress.toLowerCase();
  const now = new Date().toISOString();

  // Look up existing rows by fid and by wallet (independent partial-unique
  // constraints). We deliberately do NOT filter on `is_active` here — the
  // partial unique constraints apply regardless of soft-delete status, so
  // filtering inactive rows out would let an INSERT/UPDATE collide with an
  // inactive row's fid/wallet. Reactivation behavior mirrors addToAllowlist
  // in allowlistService.js.
  const { data: existingByFid } = await db.client
    .from("allowlist_entries")
    .select("id, fid, wallet_address, is_active")
    .eq("fid", fid)
    .single();

  const { data: existingByWallet } = await db.client
    .from("allowlist_entries")
    .select("id, fid, wallet_address, is_active")
    .eq("wallet_address", addr)
    .single();

  // Case: self-link — same row already has this (fid, wallet) pairing.
  if (
    existingByFid &&
    existingByWallet &&
    existingByFid.id === existingByWallet.id
  ) {
    const { data, error } = await db.client
      .from("allowlist_entries")
      .update({
        username: username || null,
        display_name: displayName || null,
        is_active: true,
        wallet_resolved_at: now,
        updated_at: now,
      })
      .eq("id", existingByFid.id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, entry: data };
  }

  // Cross-wallet conflict: existing fid row points to a different wallet.
  // Clear or delete it first so the partial-unique constraint on `fid` is free.
  //
  // NOTE: These two writes (clear-old + write-new) are NOT wrapped in a
  // Postgres transaction — supabase-js v2 has no multi-statement transaction
  // API. If the clear succeeds but the write below fails, W_old's FID columns
  // are cleared and W_new is never updated. The user's next link attempt
  // recovers cleanly (FID lookup finds nothing; falls through to insert),
  // but there is a window of inconsistency. If atomicity becomes important,
  // move this to a Supabase RPC wrapping both DML statements in a pl/pgsql
  // function.
  if (existingByFid && existingByFid.id !== existingByWallet?.id) {
    if (!existingByFid.wallet_address) {
      const { error } = await db.client
        .from("allowlist_entries")
        .delete()
        .eq("id", existingByFid.id);
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await db.client
        .from("allowlist_entries")
        .update({
          fid: null,
          username: null,
          display_name: null,
          wallet_resolved_at: null,
          updated_at: now,
        })
        .eq("id", existingByFid.id);
      if (error) return { success: false, error: error.message };
    }
  }

  // Case: wallet row exists — update in place.
  if (existingByWallet) {
    const { data, error } = await db.client
      .from("allowlist_entries")
      .update({
        fid,
        username: username || null,
        display_name: displayName || null,
        source: "farcaster-link",
        is_active: true,
        wallet_resolved_at: now,
        updated_at: now,
      })
      .eq("id", existingByWallet.id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, entry: data };
  }

  // Case: insert fresh.
  const { data, error } = await db.client
    .from("allowlist_entries")
    .insert({
      fid,
      wallet_address: addr,
      username: username || null,
      display_name: displayName || null,
      source: "farcaster-link",
      is_active: true,
      added_at: now,
      wallet_resolved_at: now,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, entry: data };
}

/**
 * Clear the FID columns on the wallet's row. Idempotent.
 * Returns { success: true, noop?: true } or { success: false, error }.
 */
export async function unlinkFarcasterFromWallet(walletAddress) {
  if (!hasSupabase) return { success: false, error: "Database not configured" };
  if (!walletAddress) return { success: false, error: "walletAddress is required" };

  const addr = walletAddress.toLowerCase();

  const { data: existing } = await db.client
    .from("allowlist_entries")
    .select("id, fid, wallet_address")
    .eq("wallet_address", addr)
    .single();

  if (!existing || existing.fid == null) {
    return { success: true, noop: true };
  }

  const { error } = await db.client
    .from("allowlist_entries")
    .update({
      fid: null,
      username: null,
      display_name: null,
      wallet_resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
