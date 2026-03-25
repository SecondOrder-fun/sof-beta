#!/usr/bin/env bash
# load-env.sh — Sources the correct env file for the active NETWORK.
#
# Usage (from package scripts):
#   source ../../scripts/load-env.sh
#
# Requires NETWORK to be set (local|testnet|mainnet).
# Looks for env/.env.${NETWORK} in the current working directory.

set -euo pipefail

NETWORK="${NETWORK:-local}"

ENV_FILE="env/.env.${NETWORK}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[load-env] Warning: $ENV_FILE not found in $(pwd)" >&2
  echo "[load-env] Continuing without package-specific env vars" >&2
  return 0 2>/dev/null || exit 0
fi

echo "[load-env] Loading $ENV_FILE (NETWORK=$NETWORK)" >&2

# Export all vars from the env file
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
