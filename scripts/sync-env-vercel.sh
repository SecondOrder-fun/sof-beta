#!/usr/bin/env bash
# sync-env-vercel.sh — Push frontend env vars to Vercel.
#
# Usage:
#   scripts/sync-env-vercel.sh --network testnet [--dry-run]
#   scripts/sync-env-vercel.sh --network testnet --vercel-target preview,production
#
# Reads:
#   - .env.platform (root) for VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID
#   - .env.shared (root) for shared non-secret vars
#   - packages/frontend/env/.env.{network} for frontend-specific vars
#
# Behavior:
#   - Validates Vercel token by hitting the API
#   - Default target mapping: testnet→preview, mainnet→production
#   - --vercel-target overrides; accepts comma-separated list (e.g.,
#     preview,production) for the transitional state where on-chain is
#     still testnet but the public URL ("production") needs them too.
#   - Each var is pushed with target = [<all intended targets>] in one
#     batch call via /v10/projects/.../env?upsert=true.
#   - Diff treats a var as "unchanged" only when value matches AND every
#     intended target is already covered by the existing Vercel row.
#   - --dry-run shows what would change without touching anything

set -euo pipefail

# ── Parse arguments ──────────────────────────────────────────────────
NETWORK=""
DRY_RUN=false
VERCEL_TARGETS_RAW=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --vercel-target) VERCEL_TARGETS_RAW="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$NETWORK" ]; then
  echo "Usage: scripts/sync-env-vercel.sh --network <testnet|mainnet> [--vercel-target <preview|production|both>] [--dry-run]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Load platform tokens ────────────────────────────────────────────
PLATFORM_FILE="$ROOT_DIR/.env.platform"
if [ ! -f "$PLATFORM_FILE" ]; then
  echo "[vercel] ERROR: .env.platform not found at $PLATFORM_FILE"
  echo "[vercel] Copy .env.platform.example to .env.platform and fill in tokens"
  exit 1
fi

set -a
source "$PLATFORM_FILE"
set +a

if [ -z "${VERCEL_TOKEN:-}" ] || [ -z "${VERCEL_PROJECT_ID:-}" ] || [ -z "${VERCEL_TEAM_ID:-}" ]; then
  echo "[vercel] ERROR: Missing VERCEL_TOKEN, VERCEL_PROJECT_ID, or VERCEL_TEAM_ID in .env.platform"
  exit 1
fi

# ── Validate token ──────────────────────────────────────────────────
echo -n "[vercel] Authenticating... "
AUTH_RESPONSE=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://api.vercel.com/v2/user?teamId=${VERCEL_TEAM_ID}" \
  -H "Authorization: Bearer $VERCEL_TOKEN")

if [ "$AUTH_RESPONSE" != "200" ]; then
  echo "FAILED (HTTP $AUTH_RESPONSE)"
  echo "[vercel] ERROR: Token validation failed. Check VERCEL_TOKEN."
  exit 1
fi
echo "OK"

# ── Resolve Vercel targets (single value or multi-target list) ──────
# Default mapping mirrors the eventual split: testnet→preview-only,
# mainnet→production-only. Override with --vercel-target preview,production
# during the transition state where on-chain is still testnet but the
# public URL ("production") needs the same vars.
if [ -n "$VERCEL_TARGETS_RAW" ]; then
  IFS=',' read -ra VERCEL_TARGETS_ARR <<< "$VERCEL_TARGETS_RAW"
else
  case "$NETWORK" in
    testnet) VERCEL_TARGETS_ARR=("preview") ;;
    mainnet) VERCEL_TARGETS_ARR=("production") ;;
    *) echo "[vercel] ERROR: Unknown network: $NETWORK (expected testnet|mainnet)"; exit 1 ;;
  esac
fi

# Validate each target value
for t in "${VERCEL_TARGETS_ARR[@]}"; do
  case "$t" in
    preview|production|development) ;;
    *) echo "[vercel] ERROR: Invalid target '$t' (must be preview|production|development)"; exit 1 ;;
  esac
done

# Pre-build the JSON array for the upsert payload, e.g. ["preview","production"]
TARGETS_JSON=$(printf '%s\n' "${VERCEL_TARGETS_ARR[@]}" | jq -R . | jq -sc .)

echo "[vercel] Targets: ${VERCEL_TARGETS_ARR[*]} (network=$NETWORK)"

# ── Collect env vars to push ────────────────────────────────────────
declare -A ENV_VARS

# Load .env.shared
SHARED_FILE="$ROOT_DIR/.env.shared"
if [ -f "$SHARED_FILE" ]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # CRITICAL: Strip whitespace/newlines — trailing spaces break addresses silently
    value="$(echo -n "$value" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    ENV_VARS["$key"]="$value"
  done < "$SHARED_FILE"
fi

# Load package env file
PKG_ENV_FILE="$ROOT_DIR/packages/frontend/env/.env.${NETWORK}"
if [ ! -f "$PKG_ENV_FILE" ]; then
  echo "[vercel] ERROR: $PKG_ENV_FILE not found"
  exit 1
fi

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # CRITICAL: Strip whitespace/newlines — trailing spaces break addresses silently
  value="$(echo -n "$value" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  ENV_VARS["$key"]="$value"
done < "$PKG_ENV_FILE"

# ── Fetch current Vercel env vars ───────────────────────────────────
echo "[vercel] Fetching current env vars..."
CURRENT_VARS=$(curl -s \
  "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}" \
  -H "Authorization: Bearer $VERCEL_TOKEN")

# Build maps of (key → value) and (key → space-separated target list).
# A var is "fully covered" only if its current target list contains
# EVERY one of our intended targets. Anything short of that is an
# expansion (push needed).
declare -A CURRENT_VALUES
declare -A CURRENT_TARGETS
while IFS=$'\t' read -r key value targets; do
  CURRENT_VALUES["$key"]="$value"
  CURRENT_TARGETS["$key"]="$targets"
done < <(echo "$CURRENT_VARS" | jq -r '.envs[] | [.key, .value, (.target | join(" "))] | @tsv' 2>/dev/null || true)

target_in_list() {
  local needle="$1"
  shift
  for hay in "$@"; do
    [ "$hay" = "$needle" ] && return 0
  done
  return 1
}

# ── Diff and push ───────────────────────────────────────────────────
ADDED=0
CHANGED=0
UNCHANGED=0
REMOVED=0

echo ""
echo "[vercel] ── Changes ──"

# Build JSON array for batch upsert
JSON_ARRAY="["
FIRST=true

for key in $(echo "${!ENV_VARS[@]}" | tr ' ' '\n' | sort); do
  value="${ENV_VARS[$key]}"

  if [ -n "${CURRENT_VALUES[$key]+x}" ]; then
    current_value="${CURRENT_VALUES[$key]}"
    # shellcheck disable=SC2206
    current_targets_arr=(${CURRENT_TARGETS[$key]})

    # Are all our intended targets already on this row?
    all_covered=true
    for want in "${VERCEL_TARGETS_ARR[@]}"; do
      if ! target_in_list "$want" "${current_targets_arr[@]}"; then
        all_covered=false
        break
      fi
    done

    if [ "$current_value" = "$value" ] && [ "$all_covered" = true ]; then
      echo "  $key: unchanged"
      # Use `: $((...))` not `((var++))`: under `set -e`, post-increment
      # returns the pre-value (0 on first call), and bash treats a 0
      # arithmetic result as failure, killing the script silently.
      : $((UNCHANGED++))
      continue
    elif [ "$current_value" != "$value" ]; then
      echo "  $key: CHANGED (value redacted)"
      : $((CHANGED++))
    else
      echo "  $key: target expansion → ${VERCEL_TARGETS_ARR[*]}"
      : $((ADDED++))
    fi
  else
    echo "  $key: ADDED (value redacted)"
    : $((ADDED++))
  fi

  if [ "$FIRST" = true ]; then FIRST=false; else JSON_ARRAY+=","; fi
  JSON_ARRAY+="{\"key\":\"${key}\",\"value\":\"${value}\",\"type\":\"plain\",\"target\":${TARGETS_JSON}}"
done

# Check for removals (vars in Vercel but not in our env file)
for key in $(echo "${!CURRENT_VALUES[@]}" | tr ' ' '\n' | sort); do
  if [ -z "${ENV_VARS[$key]+x}" ]; then
    echo "  $key: in Vercel but NOT in env file (not removed — manual cleanup needed)"
    : $((REMOVED++))
  fi
done

JSON_ARRAY+="]"

echo ""
echo "[vercel] Summary: $ADDED added, $CHANGED changed, $UNCHANGED unchanged, $REMOVED extra in Vercel"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[vercel] DRY RUN — no changes applied"
  exit 0
fi

if [ $ADDED -eq 0 ] && [ $CHANGED -eq 0 ]; then
  echo "[vercel] Nothing to update"
  exit 0
fi

# ── Push via upsert API ─────────────────────────────────────────────
echo ""
echo -n "[vercel] Pushing ${ADDED} new + ${CHANGED} updated vars... "

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true&teamId=${VERCEL_TEAM_ID}" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$JSON_ARRAY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "OK"
else
  echo "FAILED (HTTP $HTTP_CODE)"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  exit 1
fi

echo "[vercel] Done."
