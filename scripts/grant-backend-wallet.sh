#!/usr/bin/env bash
# grant-backend-wallet.sh — make sure the backend wallet holds PAYMASTER_ROLE on
# InfoFiMarketFactory, which gates the onPositionUpdate calls the backend sends.
#
# Usage:
#   scripts/grant-backend-wallet.sh --network testnet           # grant if missing
#   scripts/grant-backend-wallet.sh --network testnet --check   # read-only; exit 1 if missing
#
# DeployAll grants the role on a fresh deploy (step 24). Run this for an existing
# deploy, or after rotating the backend wallet: it is a no-op when the role is
# already held. deploy-env.sh runs the --check form after every env sync.
#
# Inputs:
#   - BACKEND_WALLET_ADDRESS: from packages/contracts/env/.env.<network>, else from
#     packages/backend/env/.env.<network> (the value the backend itself uses).
#   - InfoFiMarketFactory: deployments/<network>.json (.contracts.InfoFiFactory).
#   - PRIVATE_KEY (grant only): the deployer, from packages/contracts/env/.env.<network>;
#     it must hold InfoFiMarketFactory's ADMIN_ROLE.
#   - RPC_URL: optional override. Defaults: testnet → Tenderly gateway (the public
#     Base Sepolia RPC 502s under forge, see the root CLAUDE.md), mainnet → mainnet.base.org.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
# shellcheck source=lib/roles.sh
. "$ROOT_DIR/scripts/lib/roles.sh"

NETWORK=""
CHECK_ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$NETWORK" in
  testnet) DEFAULT_RPC="https://base-sepolia.gateway.tenderly.co" ;;
  mainnet) DEFAULT_RPC="https://mainnet.base.org" ;;
  *) echo "Usage: scripts/grant-backend-wallet.sh --network <testnet|mainnet> [--check]" >&2; exit 2 ;;
esac

CONTRACTS_ENV="$CONTRACTS_DIR/env/.env.$NETWORK"
BACKEND_ENV="$ROOT_DIR/packages/backend/env/.env.$NETWORK"

BACKEND_WALLET_ADDRESS="${BACKEND_WALLET_ADDRESS:-$(read_env_value "$CONTRACTS_ENV" BACKEND_WALLET_ADDRESS)}"
BACKEND_WALLET_ADDRESS="${BACKEND_WALLET_ADDRESS:-$(read_env_value "$BACKEND_ENV" BACKEND_WALLET_ADDRESS)}"
if [[ ! "$BACKEND_WALLET_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "✗ BACKEND_WALLET_ADDRESS missing or malformed (looked in $CONTRACTS_ENV and $BACKEND_ENV)" >&2
  exit 1
fi

FACTORY="$(node -e "const d=require('$CONTRACTS_DIR/deployments/$NETWORK.json'); process.stdout.write((d.contracts||{}).InfoFiFactory||'')")"
if [[ ! "$FACTORY" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "✗ No InfoFiFactory address in deployments/$NETWORK.json" >&2
  exit 1
fi

RPC_URL="${RPC_URL:-$DEFAULT_RPC}"
ROLE="$(cast keccak PAYMASTER_ROLE)"

# A failed read must never be reported as "missing" (that would also send an
# unneeded grant): abort with cast's error instead.
HAS_ROLE="$(role_read "$FACTORY" "$ROLE" "$BACKEND_WALLET_ADDRESS" "$RPC_URL")" || {
  echo "✗ Could not read PAYMASTER_ROLE on $FACTORY from $RPC_URL (error above)" >&2
  exit 1
}

if [ "$HAS_ROLE" = "true" ]; then
  echo "✓ Backend wallet $BACKEND_WALLET_ADDRESS holds PAYMASTER_ROLE on InfoFiMarketFactory $FACTORY"
  exit 0
fi

if [ -n "$CHECK_ONLY" ]; then
  echo "✗ Backend wallet $BACKEND_WALLET_ADDRESS does NOT hold PAYMASTER_ROLE on InfoFiMarketFactory $FACTORY"
  echo "  Position updates from the backend will revert. Fix: scripts/grant-backend-wallet.sh --network $NETWORK"
  exit 1
fi

PRIVATE_KEY="${PRIVATE_KEY:-$(read_env_value "$CONTRACTS_ENV" PRIVATE_KEY)}"
if [ -z "$PRIVATE_KEY" ]; then
  echo "✗ PRIVATE_KEY (deployer) not set and not found in $CONTRACTS_ENV" >&2
  exit 1
fi
[[ "$PRIVATE_KEY" != 0x* ]] && PRIVATE_KEY="0x$PRIVATE_KEY"

echo "Granting PAYMASTER_ROLE on $FACTORY to $BACKEND_WALLET_ADDRESS ($NETWORK)..."
(
  cd "$CONTRACTS_DIR"
  PRIVATE_KEY="$PRIVATE_KEY" BACKEND_WALLET_ADDRESS="$BACKEND_WALLET_ADDRESS" INFOFI_FACTORY_ADDRESS="$FACTORY" \
    forge script script/deploy/24_GrantBackendWallet.s.sol:GrantBackendWallet --sig "run()" \
      --rpc-url "$RPC_URL" --broadcast --slow
)

ERRF="$(mktemp)"
if role_wait "$FACTORY" "$ROLE" "$BACKEND_WALLET_ADDRESS" "$RPC_URL" true 2>"$ERRF"; then
  rm -f "$ERRF"
  echo "✓ Granted. Backend wallet $BACKEND_WALLET_ADDRESS now holds PAYMASTER_ROLE."
else
  echo "✗ Could not confirm the grant: PAYMASTER_ROLE $(cat "$ERRF"). Check the forge output above." >&2
  rm -f "$ERRF"
  exit 1
fi
