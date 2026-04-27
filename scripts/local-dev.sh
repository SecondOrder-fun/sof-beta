#!/usr/bin/env bash
# ==========================================================================
# Local Development Environment — Single Command Setup
# ==========================================================================
#
# Usage:
#   ./scripts/local-dev.sh          # Start everything
#   ./scripts/local-dev.sh stop     # Stop everything
#   ./scripts/local-dev.sh restart  # Stop + start
#
# What it does:
#   1. Starts infrastructure (Anvil, Redis, Postgres) via docker-compose
#   2. Waits for contract deployment
#   3. Starts Supabase local (API layer the backend needs)
#   4. Seeds admin wallets in Supabase DB
#   5. Grants on-chain roles to dev wallets
#   6. Approves RolloverEscrow for treasury SOF spending
#   7. Funds dev wallets with SOF
#   8. Starts backend (local node process, not Docker)
#   9. Starts frontend dev server
#
# Prerequisites:
#   - Docker Desktop running
#   - supabase CLI installed (brew install supabase/tap/supabase)
#   - npm install already run
#   - forge/cast installed (foundry)
#
# ==========================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
RPC=http://127.0.0.1:8545
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEPLOYER_ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Dev wallets to seed as admin (lowercase for DB, checksummed for on-chain)
ADMIN_WALLETS=(
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"   # Anvil deployer
  "0x1ed4ac856d7a072c3a336c0971a47db86a808ff4"   # Patrick
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906"   # Test A — MetaMask (Anvil #3)
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65"   # Test A — Rabby (Anvil #4)
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc"   # Test A — Big Wallet (Anvil #5)
)
ADMIN_WALLETS_CHECKSUMMED=(
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
  "0x1eD4aC856D7a072C3a336C0971a47dB86A808Ff4"
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
)

# Wallets to fund with SOF (checksummed address, amount in ether)
FUND_WALLETS=(
  "0x1eD4aC856D7a072C3a336C0971a47dB86A808Ff4:10000"
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8:10000"
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906:10000"
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65:10000"
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc:10000"
)

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

# PID files for local processes
PID_DIR="$ROOT_DIR/.local-dev-pids"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[local-dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[local-dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[local-dev]${NC} $*"; }
err()  { echo -e "${RED}[local-dev]${NC} $*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
get_deployment() {
  python3 -c "import sys,json; print(json.load(sys.stdin)['contracts']['$1'])" \
    < "$ROOT_DIR/packages/contracts/deployments/local.json" 2>/dev/null
}

wait_for_url() {
  local url=$1 max=${2:-30} i=0
  while ! curl -sf "$url" > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -ge $max ]; then
      err "Timeout waiting for $url"
      return 1
    fi
    sleep 1
  done
}

supabase_db_exec() {
  local db_container
  db_container=$(docker ps --filter "name=supabase_db" --format "{{.Names}}" 2>/dev/null | head -1)
  if [ -z "$db_container" ]; then
    err "Supabase DB container not found"
    return 1
  fi
  docker exec -i "$db_container" psql -U postgres -d postgres -c "$1" 2>&1
}

kill_pid_file() {
  local pidfile=$1
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------
do_stop() {
  log "Stopping local dev environment..."

  # Kill local processes
  kill_pid_file "$PID_DIR/backend.pid"
  kill_pid_file "$PID_DIR/frontend.pid"

  # Also kill by port in case PID files are stale
  lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti:5174 2>/dev/null | xargs kill -9 2>/dev/null || true

  # Stop Supabase
  if command -v supabase &>/dev/null; then
    supabase stop 2>/dev/null || true
  fi

  # Stop Docker containers
  docker compose down -v 2>/dev/null || true

  rm -rf "$PID_DIR"
  ok "Stopped."
}

# ---------------------------------------------------------------------------
# start
# ---------------------------------------------------------------------------
do_start() {
  mkdir -p "$PID_DIR"

  # ------ Step 1: Docker infrastructure ------
  # Two-phase startup: bring up anvil first so we can inject EntryPoint v0.8
  # at the canonical address before the forge deploy script runs. The paymaster
  # deploy step checks for code at 0x4337...f108 and falls back to StubEntryPoint
  # only if empty, so we need to inject before deploy-contracts starts.
  log "Step 1/9: Starting Anvil + data services..."
  docker compose up -d anvil redis postgres 2>&1 | grep -v "^$" || true

  log "  Waiting for Anvil to be healthy..."
  local i=0
  while ! cast block-number --rpc-url $RPC > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -ge 30 ]; then
      err "Anvil failed to start"
      exit 1
    fi
    sleep 1
  done
  ok "  Anvil healthy (block $(cast block-number --rpc-url $RPC))"

  log "  Injecting EntryPoint v0.8 at canonical address..."
  if ! node "$ROOT_DIR/scripts/setup-local-aa.js" "$RPC" 2>&1; then
    err "EntryPoint injection failed"
    exit 1
  fi

  log "  Starting contract deployment + backend..."
  docker compose up -d deploy-contracts backend 2>&1 | grep -v "^$" || true

  # ------ Step 2: Wait for contract deployment ------
  log "Step 2/9: Waiting for contract deployment..."
  i=0
  # `-a` so we see exited containers; `docker ps` alone only shows running.
  while ! docker ps -a --format "{{.Names}} {{.Status}}" 2>/dev/null | grep -q "deploy-contracts.*Exited"; do
    i=$((i+1))
    if [ $i -ge 120 ]; then
      err "Contract deployment timed out"
      docker logs sof-beta-deploy-contracts-1 2>&1 | tail -10
      exit 1
    fi
    sleep 2
  done

  # Check deploy succeeded
  if docker logs sof-beta-deploy-contracts-1 2>&1 | grep -q "deployed successfully"; then
    ok "  Contracts deployed"
  else
    err "  Contract deployment failed:"
    docker logs sof-beta-deploy-contracts-1 2>&1 | tail -10
    exit 1
  fi

  # Verify RolloverEscrow is in local.json
  local escrow
  escrow=$(get_deployment RolloverEscrow) || true
  if [ -z "$escrow" ]; then
    warn "  RolloverEscrow not in local.json — rollover features will be disabled"
  else
    ok "  RolloverEscrow at $escrow"
  fi

  # ------ Step 2a: SOFPaymaster EntryPoint deposit ------
  # Forge's local simulation EVM doesn't see the EntryPoint we injected via
  # anvil_setCode, so the paymaster contract can't deposit during the deploy
  # script (it would call into "code-less" canonical address from the
  # simulator's perspective and abort). We fund it from cast, which talks to
  # the real chain that has the real EntryPoint code at 0x4337....
  local paymaster
  paymaster=$(get_deployment Paymaster) || true
  if [ -n "$paymaster" ] && [ "$paymaster" != "null" ]; then
    log "Step 2a/9: Funding SOFPaymaster EntryPoint deposit (100 ETH)..."
    if cast send "$paymaster" "deposit()" \
        --value 100ether \
        --private-key "$DEPLOYER_KEY" \
        --rpc-url "$RPC" >/dev/null 2>&1; then
      ok "  Paymaster funded with 100 ETH on EntryPoint"
    else
      warn "  Paymaster deposit failed — sponsored UserOps will revert until funded"
    fi
  else
    warn "  Paymaster not in local.json — sponsored UserOps will not work"
  fi

  # ------ Step 2b: VRF subscription setup ------
  # V2_5Mock.createSubscription() returns a blockhash-derived uint256 subId.
  # `forge script --broadcast` captures the simulated subId and encodes it into
  # fundSubscription's calldata, which then reverts with InvalidSubscription()
  # because the real-chain subId differs. Do it via cast instead — each call is
  # a single tx, return values come from the real chain.
  log "Step 2b/9: Wiring VRF subscription..."
  local vrf_coord raffle_addr
  raffle_addr=$(get_deployment Raffle)
  vrf_coord=$(cast call "$raffle_addr" "getCoordinatorAddress()(address)" --rpc-url "$RPC" 2>/dev/null) || true

  if [ -z "$vrf_coord" ] || [ "$vrf_coord" = "0x0000000000000000000000000000000000000000" ]; then
    warn "  Could not read VRF coordinator from Raffle; skipping VRF setup"
  else
    # Create subscription — parse subId from SubscriptionCreated event
    local create_tx sub_id
    create_tx=$(cast send "$vrf_coord" "createSubscription()(uint256)" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" --json 2>/dev/null)
    # Event signature: SubscriptionCreated(uint256 indexed subId, address owner)
    # First topic after the event hash is the indexed subId
    sub_id=$(echo "$create_tx" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for log in d.get('logs', []):
    if log.get('address','').lower() == '$vrf_coord'.lower():
        topics = log.get('topics', [])
        # SubscriptionCreated has 2 topics: hash + indexed subId
        if len(topics) >= 2:
            print(int(topics[1], 16))
            break
" 2>/dev/null)

    if [ -z "$sub_id" ] || [ "$sub_id" = "0" ]; then
      err "  Could not parse subscription id from createSubscription tx"
      err "  $create_tx"
      exit 1
    fi

    # Fund subscription with 100 LINK
    cast send "$vrf_coord" "fundSubscription(uint256,uint256)" "$sub_id" "$(cast --to-wei 100)" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null
    # Register Raffle as consumer
    cast send "$vrf_coord" "addConsumer(uint256,address)" "$sub_id" "$raffle_addr" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null
    # Tell the Raffle about the real subId
    local keyhash
    keyhash=$(cast call "$raffle_addr" "vrfKeyHash()(bytes32)" --rpc-url "$RPC")
    cast send "$raffle_addr" "updateVRFConfig(uint256,bytes32,uint32)" "$sub_id" "$keyhash" 500000 \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null
    ok "  VRF sub $sub_id funded, Raffle registered as consumer"
  fi

  # ------ Step 3: Start Supabase ------
  log "Step 3/9: Starting Supabase local..."
  if ! command -v supabase &>/dev/null; then
    err "supabase CLI not installed. Run: brew install supabase/tap/supabase"
    exit 1
  fi

  # Check if Supabase is already running
  if curl -sf "$SUPABASE_URL/rest/v1/" > /dev/null 2>&1; then
    ok "  Supabase already running"
  else
    supabase start 2>&1 | tail -3 || true
    wait_for_url "$SUPABASE_URL/rest/v1/" 30
    ok "  Supabase started"
  fi

  # ------ Step 4: Seed admin wallets ------
  # allowlistService looks up wallets with `.eq(wallet_address, wallet.toLowerCase())`
  # so rows must be stored lowercase even though EIP-55 checksummed addresses
  # come in as mixed case. UPSERT (not INSERT-WHERE-NOT-EXISTS) so a stale row
  # with wrong access_level gets corrected — caught us when `supabase db reset`
  # had wiped admin and a partial leftover row blocked the re-seed.
  log "Step 4/9: Seeding admin wallets in Supabase DB..."
  for wallet in "${ADMIN_WALLETS[@]}"; do
    local wallet_lc
    wallet_lc=$(echo "$wallet" | tr '[:upper:]' '[:lower:]')
    supabase_db_exec \
      "INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active) VALUES ('$wallet_lc', 'manual', 4, true) ON CONFLICT ((lower(wallet_address::text))) WHERE wallet_address IS NOT NULL DO UPDATE SET access_level = EXCLUDED.access_level, is_active = true, source = 'manual';" \
      > /dev/null 2>&1
  done
  ok "  ${#ADMIN_WALLETS[@]} admin wallet(s) seeded"

  # ------ Step 5: Grant on-chain roles ------
  log "Step 5/9: Granting on-chain roles..."
  local raffle
  raffle=$(get_deployment Raffle)
  local creator_role
  creator_role=$(cast keccak "SEASON_CREATOR_ROLE")
  local admin_role="0x0000000000000000000000000000000000000000000000000000000000000000"

  for wallet in "${ADMIN_WALLETS_CHECKSUMMED[@]}"; do
    # Skip deployer — already has roles from deployment
    if [ "$wallet" = "$DEPLOYER_ADDR" ]; then
      continue
    fi

    cast send "$raffle" "grantRole(bytes32,address)" "$creator_role" "$wallet" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null 2>&1 || true
    cast send "$raffle" "grantRole(bytes32,address)" "$admin_role" "$wallet" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null 2>&1 || true
  done
  ok "  Roles granted"

  # ------ Step 6: Treasury approval for RolloverEscrow ------
  log "Step 6/9: Treasury approval for RolloverEscrow..."
  if [ -n "$escrow" ]; then
    local sof
    sof=$(get_deployment SOFToken)
    cast send "$sof" "approve(address,uint256)" "$escrow" "$(cast max-uint)" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null 2>&1
    ok "  Treasury approved escrow for SOF spending"
  else
    warn "  Skipped (no RolloverEscrow deployed)"
  fi

  # ------ Step 7: Fund dev wallets ------
  log "Step 7/9: Funding dev wallets with SOF..."
  local sof
  sof=$(get_deployment SOFToken)
  for entry in "${FUND_WALLETS[@]}"; do
    local wallet="${entry%%:*}"
    local amount="${entry##*:}"
    cast send "$sof" "transfer(address,uint256)" "$wallet" "$(cast --to-wei "$amount")" \
      --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" > /dev/null 2>&1 || true
  done
  ok "  ${#FUND_WALLETS[@]} wallet(s) funded"

  # ------ Step 8: Start backend ------
  log "Step 8/9: Starting backend..."
  # Stop Docker backend container (it can't work — no node_modules)
  docker stop sof-beta-backend-1 > /dev/null 2>&1 || true

  # Kill any existing backend on port 3000
  lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1

  cd "$ROOT_DIR/packages/backend"
  NETWORK=LOCAL \
  RPC_URL=$RPC \
  REDIS_URL=redis://127.0.0.1:6379 \
  SUPABASE_URL=$SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  BACKEND_WALLET_PRIVATE_KEY=$DEPLOYER_KEY \
  BACKEND_WALLET_ADDRESS=$DEPLOYER_ADDR \
  PAYMASTER_RPC_URL=$RPC \
  JWT_SECRET=local-dev-jwt-secret-must-be-at-least-32-chars \
  JWT_EXPIRES_IN=7d \
  CORS_ORIGINS="http://localhost:5174,http://127.0.0.1:5174" \
  SIWF_ALLOWED_DOMAINS="localhost,127.0.0.1" \
  PORT=3000 \
  node fastify/boot.js > "$PID_DIR/backend.log" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
  cd "$ROOT_DIR"

  wait_for_url "http://127.0.0.1:3000/api/health" 10
  ok "  Backend running on http://127.0.0.1:3000"

  # ------ Step 9: Start frontend ------
  log "Step 9/9: Starting frontend..."
  lsof -ti:5174 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1

  cd "$ROOT_DIR/packages/frontend"
  VITE_NETWORK=local npm run dev > "$PID_DIR/frontend.log" 2>&1 &
  echo $! > "$PID_DIR/frontend.pid"
  cd "$ROOT_DIR"

  wait_for_url "http://localhost:5174" 15
  ok "  Frontend running on http://localhost:5174"

  # ------ Summary ------
  echo ""
  echo -e "${GREEN}================================================${NC}"
  echo -e "${GREEN}  Local dev environment ready${NC}"
  echo -e "${GREEN}================================================${NC}"
  echo ""
  echo "  Frontend:  http://localhost:5174"
  echo "  Backend:   http://127.0.0.1:3000"
  echo "  Anvil RPC: http://127.0.0.1:8545 (chain 31337)"
  echo "  Supabase:  http://127.0.0.1:54321"
  echo "  Studio:    http://127.0.0.1:54323"
  echo ""
  echo "  Logs:"
  echo "    Backend:  tail -f $PID_DIR/backend.log"
  echo "    Frontend: tail -f $PID_DIR/frontend.log"
  echo ""
  echo "  Stop:  ./scripts/local-dev.sh stop"
  echo ""

  # Verify admin access for Account[0] (deployer) and Patrick — both must be 4
  # or contract-admin actions silently fall back to public access.
  local verify_failed=0
  for idx in 0 1; do
    local addr=${ADMIN_WALLETS_CHECKSUMMED[$idx]}
    local resp level
    resp=$(curl -s "http://127.0.0.1:3000/api/access/check?wallet=$addr" 2>/dev/null)
    level=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessLevel',0))" 2>/dev/null || echo "0")
    if [ "$level" = "4" ]; then
      ok "Admin access verified for $addr"
    else
      warn "Admin access check returned level=$level for $addr (expected 4)"
      warn "  Response: $resp"
      verify_failed=1
    fi
  done
  if [ "$verify_failed" = "1" ]; then
    warn "One or more admin checks failed — review output above"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${1:-start}" in
  stop)
    do_stop
    ;;
  restart)
    do_stop
    do_start
    ;;
  start|"")
    do_start
    ;;
  *)
    echo "Usage: $0 [start|stop|restart]"
    exit 1
    ;;
esac
