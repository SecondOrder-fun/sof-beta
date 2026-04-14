#!/bin/bash
# Deploy all contracts to local Anvil (Docker) and update deployments/local.json
# Usage: ./scripts/docker-deploy-local.sh
# Requires: Docker running with `docker compose up -d`, Foundry installed locally

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

# Anvil account #0 (deterministic)
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

echo ""
echo "  Deploying contracts to local Anvil..."
echo "  RPC: $RPC_URL"
echo ""

# Wait for Anvil to be ready
echo "  Waiting for Anvil..."
for i in $(seq 1 30); do
  if cast block-number --rpc-url "$RPC_URL" > /dev/null 2>&1; then
    echo "  Anvil is ready (block $(cast block-number --rpc-url "$RPC_URL"))"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ERROR: Anvil not responding at $RPC_URL"
    echo "  Run: docker compose up -d"
    exit 1
  fi
  sleep 1
done

# Deploy using the main Deploy script
cd "$CONTRACTS_DIR"
echo ""
echo "  Running forge script..."
PRIVATE_KEY="$PRIVATE_KEY" forge script script/deploy/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --skip-simulation \
  2>&1 | grep -E "deployed to:|Chain ID:" || true

echo ""
echo "  Deploying SOFSmartAccount..."
PRIVATE_KEY="$PRIVATE_KEY" forge script script/deploy/DeploySOFSmartAccount.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --skip-simulation \
  2>&1 | grep -E "deployed to:|Chain ID:" || true

echo ""
echo "  Local deployment complete!"
echo "  Update deployments/local.json with the addresses above."
echo ""
