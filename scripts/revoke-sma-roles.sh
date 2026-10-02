#!/usr/bin/env bash
# revoke-sma-roles.sh — take back the admin roles that the retired deploy step
# ConfigureRoles §9b mirrored from the deployer onto the deployer's ERC-4337 smart
# account (SMA). Smart accounts and the paymaster are gone (contracts 0.40.0), so
# nothing legitimate uses those grants any more; leaving them in place only widens
# who can administer Raffle and SeasonFactory.
#
# Usage:
#   scripts/revoke-sma-roles.sh --network testnet --address 0x… --check   # read-only; exit 1 if any role is held
#                                                                          #   (or, with a "✗ could not read" line, if a read fails)
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
# The revokes are sent by packages/contracts/script/ops/RevokeSmaRoles.s.sol (forge,
# --broadcast --slow); role reads and the post-send check use scripts/lib/roles.sh.
# Idempotent: a role the address no longer holds is skipped.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
# shellcheck source=lib/roles.sh
. "$ROOT_DIR/scripts/lib/roles.sh"

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

echo "Roles held by $TARGET on $NETWORK:"
HELD=()
for i in "${!LABELS[@]}"; do
  held="$(role_read "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET" "$RPC_URL")" || {
    echo "✗ could not read ${LABELS[$i]} ${ROLE_NAMES[$i]} for $TARGET (error above)" >&2; exit 1; }
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
  ADMIN_ROLE="$(cast call "${TARGETS[$i]}" 'getRoleAdmin(bytes32)(bytes32)' "${ROLE_HASHES[$i]}" --rpc-url "$RPC_URL")" \
    && [[ "$ADMIN_ROLE" =~ ^0x[0-9a-fA-F]{64}$ ]] || {
    echo "✗ could not read the admin role of ${ROLE_NAMES[$i]} on ${LABELS[$i]} (got: ${ADMIN_ROLE:-nothing})" >&2; exit 1; }
  held="$(role_read "${TARGETS[$i]}" "$ADMIN_ROLE" "$DEPLOYER" "$RPC_URL")" || {
    echo "✗ could not read the deployer's admin role on ${LABELS[$i]} (error above)" >&2; exit 1; }
  if [ "$held" != "true" ]; then
    echo "✗ Deployer $DEPLOYER lacks the admin role ($ADMIN_ROLE) for ${ROLE_NAMES[$i]} on ${LABELS[$i]}" >&2
    exit 1
  fi
done

# The revokes go through a forge script (--broadcast --slow), like
# grant-backend-wallet.sh: forge assigns the nonces locally from one read and
# waits for each receipt, so there is no per-send nonce lookup on the
# load-balanced gateway to go stale. (Forge's single starting read can still
# hit a lagging node right after another deployer tx; the send then fails with
# "nonce too low" — re-run.) The held (contract, role) pairs are passed in, so
# this script's list is the only list; the forge script re-checks each on-chain
# and skips any no longer held, so re-running is safe.
REVOKE_CONTRACTS=""; REVOKE_ROLES=""
for i in "${HELD[@]}"; do
  REVOKE_CONTRACTS="${REVOKE_CONTRACTS:+$REVOKE_CONTRACTS,}${TARGETS[$i]}"
  REVOKE_ROLES="${REVOKE_ROLES:+$REVOKE_ROLES,}${ROLE_HASHES[$i]}"
done
echo "Revoking ${#HELD[@]} role(s) from $TARGET through script/ops/RevokeSmaRoles.s.sol..."
FORGE_FAILED=0
(
  cd "$CONTRACTS_DIR"
  PRIVATE_KEY="$PRIVATE_KEY" REVOKE_TARGET="$TARGET" \
    REVOKE_CONTRACTS="$REVOKE_CONTRACTS" REVOKE_ROLES="$REVOKE_ROLES" \
    forge script script/ops/RevokeSmaRoles.s.sol:RevokeSmaRoles \
      --rpc-url "$RPC_URL" --broadcast --slow
) || FORGE_FAILED=1

# Check every role even if forge failed partway, so the report says which
# roles are still held.
FAILED=0
for i in "${HELD[@]}"; do
  if ! why="$(role_wait "${TARGETS[$i]}" "${ROLE_HASHES[$i]}" "$TARGET" "$RPC_URL" false 2>&1)"; then
    echo "✗ ${LABELS[$i]} ${ROLE_NAMES[$i]} $why" >&2
    FAILED=1
  fi
done
if [ "$FORGE_FAILED" -ne 0 ]; then
  echo "✗ The forge broadcast failed (see its output above). Re-run to revoke what is left." >&2
  exit 1
fi
[ "$FAILED" -eq 0 ] || exit 1
echo "✓ Revoked. $TARGET holds none of the mirrored admin roles."
