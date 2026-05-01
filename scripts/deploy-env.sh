#!/usr/bin/env bash
# deploy-env.sh — Orchestrator that syncs env vars to both Vercel and Railway.
#
# Usage:
#   scripts/deploy-env.sh --network testnet [--dry-run]
#   npm run deploy:env -- --network testnet --dry-run
#   npm run deploy:env:dry -- --network testnet

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Parse arguments ──────────────────────────────────────────────────
NETWORK=""
DRY_RUN=""
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; PASSTHROUGH_ARGS+=("$1" "$2"); shift 2 ;;
    --dry-run) DRY_RUN="--dry-run"; PASSTHROUGH_ARGS+=("$1"); shift ;;
    *) PASSTHROUGH_ARGS+=("$1"); shift ;;
  esac
done

if [ -z "$NETWORK" ]; then
  echo "Usage: scripts/deploy-env.sh --network <testnet|mainnet> [--vercel-target preview,production] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  --network         Target network (testnet|mainnet)"
  echo "  --vercel-target   Override default Vercel scope mapping. Comma-separated"
  echo "                    list of preview|production|development. Default:"
  echo "                    testnet→preview, mainnet→production. Use"
  echo "                    'preview,production' during the transitional state"
  echo "                    where on-chain is still testnet but the public URL"
  echo "                    needs the same vars. Vercel-only; Railway ignores."
  echo "  --dry-run         Show what would change without applying"
  exit 1
fi

echo "╔══════════════════════════════════════════════════════╗"
echo "║  deploy-env: $NETWORK ${DRY_RUN:+(dry-run)}                    "
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Sync Vercel (frontend) ──────────────────────────────────────────
echo "━━━ Vercel (frontend) ━━━"
VERCEL_EXIT=0
"$SCRIPT_DIR/sync-env-vercel.sh" "${PASSTHROUGH_ARGS[@]}" || VERCEL_EXIT=$?
echo ""

# ── Sync Railway (backend) ─────────────────────────────────────────
echo "━━━ Railway (backend) ━━━"
RAILWAY_EXIT=0
"$SCRIPT_DIR/sync-env-railway.sh" "${PASSTHROUGH_ARGS[@]}" || RAILWAY_EXIT=$?
echo ""

# ── Summary ─────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════╗"
if [ "$VERCEL_EXIT" -eq 0 ] && [ "$RAILWAY_EXIT" -eq 0 ]; then
  echo "║  All syncs completed successfully                   ║"
else
  echo "║  Some syncs failed — check output above             ║"
fi
echo "╚══════════════════════════════════════════════════════╝"

if [ -n "$DRY_RUN" ]; then
  echo ""
  echo "This was a DRY RUN. To apply changes, run without --dry-run."
fi

exit $(( VERCEL_EXIT + RAILWAY_EXIT ))
