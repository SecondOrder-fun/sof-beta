#!/usr/bin/env bash
# revoke-sma-roles.sh — take back the admin roles that the retired deploy step
# ConfigureRoles §9b mirrored from the deployer onto the deployer's ERC-4337 smart
# account (SMA). Smart accounts and the paymaster are gone (contracts 0.40.0), so
# nothing legitimate uses those grants any more; leaving them in place only widens
# who can administer Raffle and SeasonFactory.
#
# Usage:
#   scripts/revoke-sma-roles.sh --network testnet --address 0x… --check   # read-only; exit 1 if any role is held
#                                                                          #   (or, with a "✗ … read failed" line, if a read fails)
#   scripts/revoke-sma-roles.sh --network testnet --address 0x…           # revoke every role still held
#
# The roles §9b granted, all checked here:
#   - Raffle:        DEFAULT_ADMIN_ROLE, SEASON_CREATOR_ROLE, EMERGENCY_ROLE
#   - SeasonFactory: DEFAULT_ADMIN_ROLE
#
# Inputs:
#   - --address: the smart account to strip (required). Not hardcoded: it is the
#     address SOFSmartAccountFactory.getAddress(deployer) returned on that network.
#     Refused if it is the deployer itself, which would revoke the deployer's own roles.
#   - Raffle / SeasonFactory: deployments/<network>.json (.contracts.Raffle / .SeasonFactory).
#   - PRIVATE_KEY (revoke only): the deployer, from packages/contracts/env/.env.<network>;
#     it must hold each role's admin role (DEFAULT_ADMIN_ROLE) on each contract.
#   - RPC_URL: optional override. Defaults: testnet → Tenderly gateway (the public
#     Base Sepolia RPC 502s under load, see the root CLAUDE.md), mainnet → mainnet.base.org.
#
# Idempotent: a role the address no longer holds is skipped.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"

USAGE="Usage: scripts/revoke-sma-roles.sh --network <testnet|mainnet> --address <0x…> [--check]"

NETWORK=""
TARGET=""
CHECK_ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="${2:-}"; shift 2 ;;
    --address) TARGET="${2:-}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    *) echo "Unknown argument: $1" >&2; echo "$USAGE" >&2; exit 2 ;;
  esac
done

case "$NETWORK" in
  testnet) DEFAULT_RPC="https://base-sepolia.gateway.tenderly.co" ;;
  mainnet) DEFAULT_RPC="https://mainnet.base.org" ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac

if [[ ! "$TARGET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "✗ --address missing or malformed (expected 0x + 40 hex chars)" >&2
  echo "$USAGE" >&2
  exit 2
fi
if [ "$(echo "$TARGET" | tr 'A-F' 'a-f')" = "0x0000000000000000000000000000000000000000" ]; then
  echo "✗ --address is the zero address" >&2
  exit 2
fi

# Read one KEY=value from an env file without sourcing the rest of it.
read_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  { grep -E "^${key}=" "$file" || true; } | tail -1 | cut -d= -f2- | tr -d "\"' \r\n"
}

# One address from deployments/<network>.json, validated.
deployment_address() {
  local key="$1" addr
  addr="$(node -e "const d=require('$CONTRACTS_DIR/deployments/$NETWORK.json'); process.stdout.write((d.contracts||{})['$key']||'')")"
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || [ "$addr" = "0x0000000000000000000000000000000000000000" ]; then
    echo "✗ No $key address in deployments/$NETWORK.json" >&2
    exit 1
  fi
  printf '%s' "$addr"
}

RAFFLE="$(deployment_address Raffle)"
SEASON_FACTORY="$(deployment_address SeasonFactory)"
RPC_URL="${RPC_URL:-$DEFAULT_RPC}"

DEFAULT_ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
SEASON_CREATOR_ROLE="$(cast keccak SEASON_CREATOR_ROLE)"
EMERGENCY_ROLE="$(cast keccak EMERGENCY_ROLE)"

# Parallel arrays: contract label, contract address, role name, role hash.
LABELS=(Raffle Raffle Raffle SeasonFactory)
TARGETS=("$RAFFLE" "$RAFFLE" "$RAFFLE" "$SEASON_FACTORY")
ROLE_NAMES=(SEASON_CREATOR_ROLE EMERGENCY_ROLE DEFAULT_ADMIN_ROLE DEFAULT_ADMIN_ROLE)
ROLE_HASHES=("$SEASON_CREATOR_ROLE" "$EMERGENCY_ROLE" "$DEFAULT_ADMIN_ROLE" "$DEFAULT_ADMIN_ROLE")

# role_state CONTRACT ROLE ACCOUNT — prints "true", "false" or "error: <cast
# output>"; never fails.
role_state() {
  local out
  if out="$(cast call "$1" 'hasRole(bytes32,address)(bool)' "$2" "$3" --rpc-url "$RPC_URL" 2>&1)" \
      && { [ "$out" = true ] || [ "$out" = false ]; }; then
    printf '%s' "$out"
  else
    printf 'error: %s' "$out"
  fi
}

# has_role CONTRACT ROLE ACCOUNT — prints true/false; a failed or odd read
# prints cast's output and returns non-zero. Callers assign it on its own line
# (held="$(has_role ...)") so set -e aborts the run instead of treating a
# failed read as "not held".
has_role() {
  local out
  out="$(role_state "$1" "$2" "$3")"
  if [[ "$out" == error:* ]]; then
    echo "✗ hasRole($2, $3) read failed on $1: ${out#error: }" >&2
    return 1
  fi
  printf '%s' "$out"
}

echo "Roles held by $TARGET on $NETWORK:"
HELD=()
for i in "${!LABELS[@]}"; do
  held="$(has_role "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET")"
  if [ "$held" = "true" ]; then
    echo "  ✗ ${LABELS[$i]} (${TARGETS[$i]}) ${ROLE_NAMES[$i]}"
    HELD+=("$i")
  else
    echo "  ✓ ${LABELS[$i]} (${TARGETS[$i]}) ${ROLE_NAMES[$i]} — not held"
  fi
done

if [ "${#HELD[@]}" -eq 0 ]; then
  echo "✓ $TARGET holds none of the mirrored admin roles."
  exit 0
fi

if [ -n "$CHECK_ONLY" ]; then
  echo "✗ $TARGET still holds ${#HELD[@]} role(s). Fix: scripts/revoke-sma-roles.sh --network $NETWORK --address $TARGET"
  exit 1
fi

CONTRACTS_ENV="$CONTRACTS_DIR/env/.env.$NETWORK"
PRIVATE_KEY="${PRIVATE_KEY:-$(read_env_value "$CONTRACTS_ENV" PRIVATE_KEY)}"
if [ -z "$PRIVATE_KEY" ]; then
  echo "✗ PRIVATE_KEY (deployer) not set and not found in $CONTRACTS_ENV" >&2
  exit 1
fi
[[ "$PRIVATE_KEY" != 0x* ]] && PRIVATE_KEY="0x$PRIVATE_KEY"

DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
if [ "$(echo "$DEPLOYER" | tr 'A-F' 'a-f')" = "$(echo "$TARGET" | tr 'A-F' 'a-f')" ]; then
  echo "✗ --address is the deployer ($DEPLOYER) itself; refusing to revoke its own roles" >&2
  exit 1
fi

# Every revoke must be authorised by the role's admin role: check them all up
# front so the run is all-or-nothing rather than failing halfway.
for i in "${HELD[@]}"; do
  ADMIN_ROLE="$(cast call "${TARGETS[$i]}" 'getRoleAdmin(bytes32)(bytes32)' "${ROLE_HASHES[$i]}" --rpc-url "$RPC_URL")"
  held="$(has_role "${TARGETS[$i]}" "$ADMIN_ROLE" "$DEPLOYER")"
  if [ "$held" != "true" ]; then
    echo "✗ Deployer $DEPLOYER lacks the admin role ($ADMIN_ROLE) for ${ROLE_NAMES[$i]} on ${LABELS[$i]}" >&2
    exit 1
  fi
done

# Nonces are assigned here instead of letting cast look one up per send: the
# Tenderly gateway can answer a lookup from a node one block behind right after
# the previous send confirmed. If the starting read is itself stale, the node
# rejects the send with "nonce too low" and names the nonce it expects ("next
# nonce N", or geth's "state: N"); the script then re-reads the role — so a
# send that did land is never repeated — and resends with that nonce, at most
# twice. cast send waits for each receipt; any other send error stops the run,
# and re-running is safe (only roles still held are revoked). Not covered: a
# lagging node that accepts a stale-nonce tx it can never mine — cast then
# times out waiting for the receipt; re-run.
NONCE="$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC_URL")" || {
  echo "✗ could not read the deployer's nonce from $RPC_URL" >&2; exit 1; }
[[ "$NONCE" =~ ^[0-9]+$ ]] || { echo "✗ unexpected nonce from $RPC_URL: $NONCE" >&2; exit 1; }

# expected_nonce ERROR_TEXT — the nonce a "nonce too low" rejection says the
# node expects, or nothing. Pure bash (no pipeline for pipefail to trip on).
expected_nonce() {
  local lower="${1,,}"
  [[ "$lower" == *"nonce too low"* ]] || return 0
  if [[ "$lower" =~ next\ nonce\ ([0-9]+) ]] || [[ "$lower" =~ state:\ ([0-9]+) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

send_revoke() {
  local i="$1" attempt err next
  for attempt in 1 2 3; do
    if err="$(cast send "${TARGETS[$i]}" 'revokeRole(bytes32,address)' "${ROLE_HASHES[$i]}" "$TARGET" \
        --nonce "$NONCE" --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" 2>&1 >/dev/null)"; then
      NONCE=$((NONCE + 1))
      return 0
    fi
    next="$(expected_nonce "$err")"
    if [ "$attempt" -eq 3 ] || [ -z "$next" ] || [ "$next" -le "$NONCE" ]; then
      echo "$err" >&2
      return 1
    fi
    NONCE="$next"
    # A rejection can follow a broadcast that did land (e.g. a client-side
    # rebroadcast); don't revoke twice.
    if [ "$(role_state "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET")" = false ]; then
      echo "  the role is already revoked (an earlier broadcast landed); not resending"
      return 0
    fi
    echo "  the RPC's nonce was stale; the node expects $next, resending"
  done
}

for i in "${HELD[@]}"; do
  echo "Revoking ${ROLE_NAMES[$i]} on ${LABELS[$i]} (${TARGETS[$i]}) from $TARGET (nonce $NONCE)..."
  send_revoke "$i"
done

# The same lagging node can still report a just-revoked role as held, or a read
# can fail transiently: re-check only the roles not yet confirmed revoked, up to
# 5 times 3s apart, before calling the run a failure.
PENDING=("${HELD[@]}")
for attempt in 1 2 3 4 5; do
  NEXT=()
  for i in "${PENDING[@]}"; do
    [ "$(role_state "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET")" = false ] || NEXT+=("$i")
  done
  PENDING=("${NEXT[@]+"${NEXT[@]}"}")
  [ "${#PENDING[@]}" -eq 0 ] && break
  [ "$attempt" -lt 5 ] && sleep 3
done
if [ "${#PENDING[@]}" -ne 0 ]; then
  for i in "${PENDING[@]}"; do
    echo "✗ ${LABELS[$i]} ${ROLE_NAMES[$i]} still reads as held (or unreadable) after the revoke" >&2
  done
  exit 1
fi
echo "✓ Revoked. $TARGET holds none of the mirrored admin roles."
