#!/usr/bin/env bash
# redeploy-launchpad.sh — replace the launchpad stack (TokenLaunchpad, placer +
# pool gate, router) on a chain whose raffle stack stays, re-point
# Raffle.setLaunchpad, allowlist USDC as a launch quote token, and record the new
# addresses in packages/contracts/deployments/<network>.json.
#
# Usage:
#   scripts/redeploy-launchpad.sh --network testnet [--no-verify] [--no-quote]
#
# Runs script/ops/RedeployLaunchpad.s.sol, then
# `extract-deployment-addresses.js --script RedeployLaunchpad.s.sol`, which
# overlays the new addresses (and the TokenLaunchpad deploy block) on the
# deployments file. Commit that file: frontend and backend read addresses from it.
#
# Inputs:
#   - PRIVATE_KEY: the deployer, from packages/contracts/env/.env.<network>; it
#     must hold DEFAULT_ADMIN_ROLE on Raffle (checked before anything is sent).
#   - TREASURY_ADDRESS: the 12% LP-fee treasury, same env file (deployer if unset).
#   - ETHERSCAN_API_KEY: same env file, for --verify (skip with --no-verify).
#   - LAUNCH_QUOTE_TOKEN / LAUNCH_QUOTE_MIN_FDV / LAUNCH_QUOTE_MAX_FDV: override
#     the quote token allowlisted below (default: the network's USDC at a
#     2,500 – 2,500,000 USDC opening valuation). --no-quote allowlists none.
#   - RPC_URL: optional override. Defaults: testnet → Tenderly gateway (the public
#     Base Sepolia RPC 502s under forge, see the root CLAUDE.md), mainnet →
#     mainnet.base.org.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
# shellcheck source=lib/roles.sh
. "$ROOT_DIR/scripts/lib/roles.sh"

NETWORK=""
VERIFY=1
QUOTE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      [ $# -ge 2 ] || { echo "--network needs a value" >&2; exit 2; }
      NETWORK="$2"; shift 2 ;;
    --no-verify) VERIFY=""; shift ;;
    --no-quote) QUOTE=""; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$NETWORK" in
  testnet)
    DEFAULT_RPC="https://base-sepolia.gateway.tenderly.co"
    CHAIN_ID=84532
    DEFAULT_USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e" ;;
  mainnet)
    DEFAULT_RPC="https://mainnet.base.org"
    CHAIN_ID=8453
    DEFAULT_USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" ;;
  *) echo "Usage: scripts/redeploy-launchpad.sh --network <testnet|mainnet> [--no-verify] [--no-quote]" >&2; exit 2 ;;
esac

CONTRACTS_ENV="$CONTRACTS_DIR/env/.env.$NETWORK"
RPC_URL="${RPC_URL:-$DEFAULT_RPC}"
load_private_key "$CONTRACTS_ENV" || exit 1

TREASURY_ADDRESS="${TREASURY_ADDRESS:-$(read_env_value "$CONTRACTS_ENV" TREASURY_ADDRESS)}"
if [ -n "$TREASURY_ADDRESS" ] && [[ ! "$TREASURY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "✗ TREASURY_ADDRESS is malformed" >&2
  exit 1
fi

if [ -n "$QUOTE" ]; then
  # 6-decimal USDC: 2,500 USDC = 2500e6 raw.
  LAUNCH_QUOTE_TOKEN="${LAUNCH_QUOTE_TOKEN:-$DEFAULT_USDC}"
  LAUNCH_QUOTE_MIN_FDV="${LAUNCH_QUOTE_MIN_FDV:-2500000000}"
  LAUNCH_QUOTE_MAX_FDV="${LAUNCH_QUOTE_MAX_FDV:-2500000000000}"
  if [[ ! "$LAUNCH_QUOTE_TOKEN" =~ ^0x[0-9a-fA-F]{40}$ ]] || [ "$(lower "$LAUNCH_QUOTE_TOKEN")" = "$ZERO_ADDRESS" ]; then
    echo "✗ LAUNCH_QUOTE_TOKEN is malformed or zero" >&2
    exit 1
  fi
else
  LAUNCH_QUOTE_TOKEN="$ZERO_ADDRESS"
  LAUNCH_QUOTE_MIN_FDV=0
  LAUNCH_QUOTE_MAX_FDV=0
fi

VERIFY_ARGS=()
if [ -n "$VERIFY" ]; then
  ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-$(read_env_value "$CONTRACTS_ENV" ETHERSCAN_API_KEY)}"
  if [ -z "$ETHERSCAN_API_KEY" ]; then
    echo "✗ ETHERSCAN_API_KEY not set and not found in $CONTRACTS_ENV (or pass --no-verify)" >&2
    exit 1
  fi
  # Etherscan V2: one endpoint, chain chosen by query (root CLAUDE.md).
  VERIFY_ARGS=(--verify --verifier etherscan
    --verifier-url "https://api.etherscan.io/v2/api?chainid=$CHAIN_ID"
    --etherscan-api-key "$ETHERSCAN_API_KEY")
fi

echo "Redeploying the launchpad on $NETWORK (quote token: $LAUNCH_QUOTE_TOKEN)..."
(
  cd "$CONTRACTS_DIR"
  # --slow: a deployer with an EIP-7702 delegation rejects forge's gapped-nonce
  # batch (root CLAUDE.md).
  PRIVATE_KEY="$PRIVATE_KEY" TREASURY_ADDRESS="$TREASURY_ADDRESS" \
  LAUNCH_QUOTE_TOKEN="$LAUNCH_QUOTE_TOKEN" \
  LAUNCH_QUOTE_MIN_FDV="$LAUNCH_QUOTE_MIN_FDV" LAUNCH_QUOTE_MAX_FDV="$LAUNCH_QUOTE_MAX_FDV" \
    forge script script/ops/RedeployLaunchpad.s.sol:RedeployLaunchpad \
      --rpc-url "$RPC_URL" --broadcast --slow ${VERIFY_ARGS[@]+"${VERIFY_ARGS[@]}"}
)

# The broadcast log, not the script's return value, is the record of what landed.
node "$ROOT_DIR/scripts/extract-deployment-addresses.js" --network "$NETWORK" --script RedeployLaunchpad.s.sol

echo "✓ Launchpad redeployed. Commit packages/contracts/deployments/$NETWORK.json."
echo "  If LAUNCHPAD_DEPLOY_BLOCK is set on the backend, update or remove it (the file now records the new block)."
echo "  Verification only, if it flaked: re-run forge with --resume --verify from $CONTRACTS_DIR."
