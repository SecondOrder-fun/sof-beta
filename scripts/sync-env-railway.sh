#!/usr/bin/env bash
# sync-env-railway.sh — Push backend env vars to Railway.
#
# Usage:
#   scripts/sync-env-railway.sh --network testnet [--dry-run]
#
# Reads:
#   - .env.platform (root) for RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, and
#     ONE of RAILWAY_API_TOKEN (account/workspace, Bearer) or RAILWAY_TOKEN
#     (project, Project-Access-Token). Project tokens are required for
#     mutations like environmentCreate.
#   - .env.shared (root) for shared non-secret vars
#   - packages/backend/env/.env.{network} for backend-specific vars
#
# Behavior:
#   - Validates Railway token by hitting the API (supports both Account
#     and Workspace tokens — both use Authorization: Bearer)
#   - Pushes all changed vars in ONE variableCollectionUpsert call with
#     skipDeploys=true (avoids the per-var-redeploy storm that triggers
#     Railway's deploy rate limit; user triggers a single redeploy after)
#   - Logs every action with diff output (values redacted)
#   - --dry-run shows what would change without touching anything
#   - Exits non-zero if the push failed

set -euo pipefail

# ── Parse arguments ──────────────────────────────────────────────────
NETWORK=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    # Vercel-only flag forwarded by deploy-env.sh — silently accept and
    # ignore so the orchestrator can pass it to both children.
    --vercel-target) shift 2 ;;
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

if [ -z "${RAILWAY_PROJECT_ID:-}" ] || [ -z "${RAILWAY_SERVICE_ID:-}" ]; then
  echo "[railway] ERROR: Missing RAILWAY_PROJECT_ID or RAILWAY_SERVICE_ID in .env.platform"
  exit 1
fi
if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
  echo "[railway] ERROR: Need RAILWAY_API_TOKEN (account/workspace) or RAILWAY_TOKEN (project) in .env.platform"
  exit 1
fi

# Pick the right auth header based on which token type is set. Project
# tokens require Project-Access-Token (NOT Authorization: Bearer); account
# and workspace tokens use Bearer. Source:
# https://docs.railway.com/integrations/api/graphql-overview
#
# Prefer workspace token when both are set: project tokens can't write to
# PR/ephemeral envs (variableCollectionUpsert returns Not Authorized), so
# the workspace token is the strictly more-capable option for this script.
if [ -n "${RAILWAY_API_TOKEN:-}" ]; then
  RAILWAY_AUTH_HEADER="Authorization: Bearer $RAILWAY_API_TOKEN"
  RAILWAY_TOKEN_TYPE="account/workspace"
else
  RAILWAY_AUTH_HEADER="Project-Access-Token: $RAILWAY_TOKEN"
  RAILWAY_TOKEN_TYPE="project"
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
  -H "$RAILWAY_AUTH_HEADER" \
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

# Push to production AND every Railway PR Environment forked from it.
# Railway names PR envs `<service>-pr-<num>` (visible in the railway-app
# bot's PR comment as "sof-beta-pr-74" etc). Those envs are created at
# PR-open time as a fork of production's THEN-current variables; later
# changes to production do NOT propagate. Without this, every new env
# var added during a PR's lifetime is missing on its preview backend
# (the airdrop pipeline silently no-op'd on PR-74 because
# SOF_AIRDROP_AMOUNT_PER_USER was added to production after PR-74 forked).
#
# We discover targets via the env list the project query already returned,
# then run the same fetch/diff/push loop against each.
TARGET_ENVS=$(echo "$PROJECT_RESPONSE" | jq -r '
  .data.project.environments.edges[]
  | .node
  | select(.name == "production" or (.name | test("-pr-[0-9]+$")))
  | "\(.id)\t\(.name)"
')

if [ -z "$TARGET_ENVS" ]; then
  echo "FAILED"
  echo "[railway] ERROR: Could not find 'production' (or any PR preview) in project '$PROJECT_NAME'"
  exit 1
fi

# Format the discovered targets for the operator. One line per env so a
# typo in PR-env naming convention is obvious in logs before we push.
TARGET_NAMES=$(echo "$TARGET_ENVS" | awk -F'\t' '{print $2}' | paste -sd, -)
echo "OK (project: $PROJECT_NAME, envs: $TARGET_NAMES)"

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

# ── Sync each target environment ───────────────────────────────────
# Loop over production + every PR-* env discovered above. Per env we run
# the same fetch → diff → push sequence we used to run only against
# production. PUSH_FAILED tracks aggregate failure across all envs;
# any single env failure flags the whole run as failed but doesn't
# short-circuit the others (a transient PR-env error shouldn't block
# the production push).
PUSH_FAILED=false
GLOBAL_ADDED=0
GLOBAL_CHANGED=0
GLOBAL_UNCHANGED=0

while IFS=$'\t' read -r ENV_ID ENV_NAME; do
  [ -z "$ENV_ID" ] && continue

  echo ""
  echo "[railway] ━━━ $ENV_NAME ━━━"

  echo "[railway] Fetching current env vars..."
  CURRENT_VARS=$(curl -sf -X POST https://backboard.railway.com/graphql/v2 \
    -H "$RAILWAY_AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"query { variables(projectId: \\\"$RAILWAY_PROJECT_ID\\\", environmentId: \\\"$ENV_ID\\\", serviceId: \\\"$RAILWAY_SERVICE_ID\\\") }\"}")

  declare -A CURRENT_VALUES=()
  while IFS=$'\t' read -r key value; do
    [ -n "$key" ] && CURRENT_VALUES["$key"]="$value"
  done < <(echo "$CURRENT_VARS" | jq -r '.data.variables | to_entries[] | [.key, .value] | @tsv' 2>/dev/null || true)

  ADDED=0
  CHANGED=0
  UNCHANGED=0
  BATCH_VARS_JSON='{}'

  echo "[railway] ── Changes ──"
  for key in $(echo "${!ENV_VARS[@]}" | tr ' ' '\n' | sort); do
    value="${ENV_VARS[$key]}"

    if [ -n "${CURRENT_VALUES[$key]+x}" ]; then
      if [ "${CURRENT_VALUES[$key]}" = "$value" ]; then
        echo "  $key: unchanged"
        # Use `: $((...))` not `((var++))`: under `set -e`, post-increment
        # returns the pre-value (0 on first call), and bash treats a 0
        # arithmetic result as failure, killing the script silently.
        : $((UNCHANGED++))
        continue
      else
        echo "  $key: CHANGED (value redacted)"
        : $((CHANGED++))
      fi
    else
      echo "  $key: ADDED (value redacted)"
      : $((ADDED++))
    fi

    # Append to the batch JSON map. `jq` handles escaping correctly even
    # for values containing quotes, newlines, etc.
    BATCH_VARS_JSON=$(jq -n \
      --argjson current "$BATCH_VARS_JSON" \
      --arg name "$key" \
      --arg val "$value" \
      '$current + {($name): $val}')
  done

  echo ""
  echo "[railway] Summary ($ENV_NAME): $ADDED added, $CHANGED changed, $UNCHANGED unchanged"
  : $((GLOBAL_ADDED += ADDED))
  : $((GLOBAL_CHANGED += CHANGED))
  : $((GLOBAL_UNCHANGED += UNCHANGED))

  # ── Push (one batched call) per env ───────────────────────────────
  # IMPORTANT: We DO NOT use the per-variable `variableUpsert` mutation
  # in a loop. Each per-variable upsert triggers a service redeploy,
  # and Railway rate-limits redeploys. Pushing 20+ vars hit the limit
  # partway through — with most vars silently failing.
  #
  # Use `variableCollectionUpsert` instead: ONE round-trip pushes all
  # changed vars, and `skipDeploys: true` suppresses the redeploy
  # entirely so we can trigger exactly one manual redeploy at the end.
  #
  # Schema source: https://docs.railway.com/integrations/api/manage-variables
  if [ "$DRY_RUN" != true ] && [ "$((ADDED + CHANGED))" -gt 0 ]; then
    echo "[railway] Pushing $((ADDED + CHANGED)) var(s) to $ENV_NAME via variableCollectionUpsert (skipDeploys=true)..."

    PAYLOAD=$(jq -n \
      --arg query 'mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}' \
      --arg pid "$RAILWAY_PROJECT_ID" \
      --arg eid "$ENV_ID" \
      --arg sid "$RAILWAY_SERVICE_ID" \
      --argjson vars "$BATCH_VARS_JSON" \
      '{query: $query, variables: {input: {projectId: $pid, environmentId: $eid, serviceId: $sid, variables: $vars, skipDeploys: true}}}')

    RESULT=$(curl -s -X POST https://backboard.railway.com/graphql/v2 \
      -H "$RAILWAY_AUTH_HEADER" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD")

    if echo "$RESULT" | jq -e '.errors' > /dev/null 2>&1; then
      echo "[railway] ERROR: variableCollectionUpsert failed for $ENV_NAME:"
      echo "$RESULT" | jq -r '.errors[].message' | sed 's/^/  /'
      PUSH_FAILED=true
    else
      echo "[railway] OK ($ENV_NAME) — variables persisted. Trigger a redeploy in the Railway dashboard"
      echo "[railway]   (or push a commit) to pick up the new env."
    fi
  fi

  unset CURRENT_VALUES
done <<< "$TARGET_ENVS"

echo ""
echo "[railway] Aggregate: $GLOBAL_ADDED added, $GLOBAL_CHANGED changed, $GLOBAL_UNCHANGED unchanged across $(echo "$TARGET_ENVS" | wc -l | tr -d ' ') env(s)"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[railway] DRY RUN — no changes applied"
  exit 0
fi

if [ "$PUSH_FAILED" = true ]; then
  echo "[railway] Done — with errors. See above."
  exit 1
fi

echo "[railway] Done."
