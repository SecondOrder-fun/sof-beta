#!/usr/bin/env bash
# revoke-sma-roles.sh — take back the admin roles that the retired deploy step
# ConfigureRoles §9b mirrored from the deployer onto the deployer's ERC-4337 smart
# account (SMA). Smart accounts and the paymaster are gone (contracts 0.40.0), so
# nothing legitimate uses those grants any more; leaving them in place only widens
# who can administer Raffle and SeasonFactory.
#
# Usage:
#   scripts/revoke-sma-roles.sh --network testnet --address 0x… --check   # read-only; exit 1 if any role is held
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

has_role() {
  cast call "$1" 'hasRole(bytes32,address)(bool)' "$2" "$3" --rpc-url "$RPC_URL"
}

echo "Roles held by $TARGET on $NETWORK:"
HELD=()
for i in "${!LABELS[@]}"; do
  if [ "$(has_role "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET")" = "true" ]; then
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
  if [ "$(has_role "${TARGETS[$i]}" "$ADMIN_ROLE" "$DEPLOYER")" != "true" ]; then
    echo "✗ Deployer $DEPLOYER lacks the admin role ($ADMIN_ROLE) for ${ROLE_NAMES[$i]} on ${LABELS[$i]}" >&2
    exit 1
  fi
done

for i in "${HELD[@]}"; do
  echo "Revoking ${ROLE_NAMES[$i]} on ${LABELS[$i]} (${TARGETS[$i]}) from $TARGET..."
  cast send "${TARGETS[$i]}" 'revokeRole(bytes32,address)' "${ROLE_HASHES[$i]}" "$TARGET" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" >/dev/null
done

FAILED=0
for i in "${HELD[@]}"; do
  if [ "$(has_role "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET")" = "true" ]; then
    echo "✗ ${LABELS[$i]} ${ROLE_NAMES[$i]} is still held after the revoke" >&2
    FAILED=1
  fi
done
if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "✓ Revoked. $TARGET holds none of the mirrored admin roles."
