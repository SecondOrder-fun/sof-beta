/**
 * farcasterLinkService — read-only lookup of an FID linked to a wallet.
 *
 * The link/unlink mutation surface was removed (PR #146 — Farcaster account
 * linking is paused in the desktop/mobile browser UI). This module retains
 * `getLinkedFidForWallet` for the wallet branch of /api/auth/verify, which
 * still surfaces a previously-linked FID as a JWT claim if one exists.
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
