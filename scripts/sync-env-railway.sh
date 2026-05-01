#!/usr/bin/env bash
# sync-env-railway.sh — Push backend env vars to Railway.
#
# Usage:
#   scripts/sync-env-railway.sh --network testnet [--dry-run]
#
# Reads:
#   - .env.platform (root) for RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID
#   - .env.shared (root) for shared non-secret vars
#   - packages/backend/env/.env.{network} for backend-specific vars
#
# Behavior:
#   - Validates Railway token by hitting the API (supports both Account
#     and Workspace tokens — both use Authorization: Bearer)
#   - Uses Railway GraphQL variableUpsert mutation (native upsert)
#   - Logs every action with diff output (values redacted)
#   - --dry-run shows what would change without touching anything

set -euo pipefail

# ── Parse arguments ──────────────────────────────────────────────────
NETWORK=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$NETWORK" ]; then
  echo "Usage: scripts/sync-env-railway.sh --network <testnet|mainnet> [--dry-run]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Load platform tokens ────────────────────────────────────────────
PLATFORM_FILE="$ROOT_DIR/.env.platform"
if [ ! -f "$PLATFORM_FILE" ]; then
  echo "[railway] ERROR: .env.platform not found at $PLATFORM_FILE"
  echo "[railway] Copy .env.platform.example to .env.platform and fill in tokens"
  exit 1
fi

set -a
source "$PLATFORM_FILE"
set +a

if [ -z "${RAILWAY_API_TOKEN:-}" ] || [ -z "${RAILWAY_PROJECT_ID:-}" ] || [ -z "${RAILWAY_SERVICE_ID:-}" ]; then
  echo "[railway] ERROR: Missing RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, or RAILWAY_SERVICE_ID in .env.platform"
  exit 1
fi

# ── Validate token + locate production environment ─────────────────
# Use `project(id:)` rather than `me { name }`. The latter only works
# with Account tokens; this query works with both Account and Workspace
# tokens (Workspace is the more security-scoped option) and validates
# RAILWAY_PROJECT_ID at the same time. Single round-trip also returns
# the environments list so we don't need a follow-up query.
#
# Schema source: https://docs.railway.com/integrations/api/manage-projects
# Token-type behaviour: https://docs.railway.com/reference/public-api
echo -n "[railway] Authenticating + finding production environment... "
PROJECT_PAYLOAD=$(jq -n \
  --arg q 'query($id:String!){project(id:$id){id name environments{edges{node{id name}}}}}' \
  --arg id "$RAILWAY_PROJECT_ID" \
  '{query:$q,variables:{id:$id}}')

PROJECT_RESPONSE=$(curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PROJECT_PAYLOAD")

if ! echo "$PROJECT_RESPONSE" | jq -e '.data.project.name' > /dev/null 2>&1; then
  echo "FAILED"
  echo "[railway] ERROR: Could not access project $RAILWAY_PROJECT_ID"
  echo "[railway] Check RAILWAY_API_TOKEN (Account or Workspace) and RAILWAY_PROJECT_ID."
  echo "[railway] Response: $PROJECT_RESPONSE"
  exit 1
fi

PROJECT_NAME=$(echo "$PROJECT_RESPONSE" | jq -r '.data.project.name')
ENV_ID=$(echo "$PROJECT_RESPONSE" | jq -r '.data.project.environments.edges[] | select(.node.name == "production") | .node.id')

if [ -z "$ENV_ID" ] || [ "$ENV_ID" = "null" ]; then
  echo "FAILED"
  echo "[railway] ERROR: Could not find 'production' environment in project '$PROJECT_NAME'"
  exit 1
fi
echo "OK (project: $PROJECT_NAME, env: production)"

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
PKG_ENV_FILE="$ROOT_DIR/packages/backend/env/.env.${NETWORK}"
if [ ! -f "$PKG_ENV_FILE" ]; then
  echo "[railway] ERROR: $PKG_ENV_FILE not found"
  exit 1
fi

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # CRITICAL: Strip whitespace/newlines — trailing spaces break addresses silently
  value="$(echo -n "$value" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  ENV_VARS["$key"]="$value"
done < "$PKG_ENV_FILE"

# ── Fetch current Railway vars ──────────────────────────────────────
echo "[railway] Fetching current env vars..."
CURRENT_VARS=$(curl -sf -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"query { variables(projectId: \\\"$RAILWAY_PROJECT_ID\\\", environmentId: \\\"$ENV_ID\\\", serviceId: \\\"$RAILWAY_SERVICE_ID\\\") }\"}")

declare -A CURRENT_VALUES
while IFS=$'\t' read -r key value; do
  CURRENT_VALUES["$key"]="$value"
done < <(echo "$CURRENT_VARS" | jq -r '.data.variables | to_entries[] | [.key, .value] | @tsv' 2>/dev/null || true)

# ── Diff and push ───────────────────────────────────────────────────
ADDED=0
CHANGED=0
UNCHANGED=0

echo ""
echo "[railway] ── Changes ──"

for key in $(echo "${!ENV_VARS[@]}" | tr ' ' '\n' | sort); do
  value="${ENV_VARS[$key]}"

  if [ -n "${CURRENT_VALUES[$key]+x}" ]; then
    if [ "${CURRENT_VALUES[$key]}" = "$value" ]; then
      echo "  $key: unchanged"
      ((UNCHANGED++))
      continue
    else
      echo "  $key: CHANGED (value redacted)"
      ((CHANGED++))
    fi
  else
    echo "  $key: ADDED (value redacted)"
    ((ADDED++))
  fi

  if [ "$DRY_RUN" = true ]; then
    continue
  fi

  # Railway has native upsert via variableUpsert mutation
  PAYLOAD=$(jq -n \
    --arg query 'mutation($input:VariableUpsertInput!){variableUpsert(input:$input)}' \
    --arg pid "$RAILWAY_PROJECT_ID" \
    --arg eid "$ENV_ID" \
    --arg sid "$RAILWAY_SERVICE_ID" \
    --arg name "$key" \
    --arg val "$value" \
    '{query: $query, variables: {input: {projectId: $pid, environmentId: $eid, serviceId: $sid, name: $name, value: $val}}}')

  RESULT=$(curl -s -X POST https://backboard.railway.com/graphql/v2 \
    -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

  if echo "$RESULT" | jq -e '.errors' > /dev/null 2>&1; then
    echo "    ^ ERROR: $(echo "$RESULT" | jq -r '.errors[0].message')"
  fi
done

echo ""
echo "[railway] Summary: $ADDED added, $CHANGED changed, $UNCHANGED unchanged"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[railway] DRY RUN — no changes applied"
  exit 0
fi

echo "[railway] Done."
