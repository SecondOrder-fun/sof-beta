#!/bin/sh
# Docker backend startup script
# Waits for contracts to be deployed on Anvil, then starts Fastify
# Reads Raffle address from deployments/local.json dynamically

RPC_URL="${RPC_URL:-http://anvil:8545}"
DEPLOYMENTS_FILE="/app/packages/contracts/deployments/local.json"
MAX_ATTEMPTS=300  # 5 minutes

echo "[backend] Waiting for contracts to be deployed on $RPC_URL..."
echo "[backend] Reading Raffle address from $DEPLOYMENTS_FILE"

ATTEMPTS=0
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  # Read the Raffle address from local.json each iteration
  # (it gets updated by DeployAll after deployment)
  RAFFLE_ADDRESS=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$DEPLOYMENTS_FILE','utf8'));
      console.log(d.contracts?.Raffle || '');
    } catch { console.log(''); }
  " 2>/dev/null)

  if [ -n "$RAFFLE_ADDRESS" ] && [ "$RAFFLE_ADDRESS" != "" ]; then
    # Check if the Raffle contract has code on-chain
    CODE=$(node -e "
      fetch('$RPC_URL', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc:'2.0',method:'eth_getCode',params:['$RAFFLE_ADDRESS','latest'],id:1})
      }).then(r=>r.json()).then(d=>console.log(d.result||'0x')).catch(()=>console.log('0x'))
    " 2>/dev/null)

    if [ "$CODE" != "0x" ] && [ -n "$CODE" ] && [ ${#CODE} -gt 4 ]; then
      echo "[backend] Contracts detected at $RAFFLE_ADDRESS. Starting Fastify..."
      break
    fi
  fi

  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $((ATTEMPTS % 10)) -eq 0 ]; then
    echo "[backend] Still waiting for contracts... (${ATTEMPTS}s)"
  fi
  sleep 1
done

if [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; then
  echo "[backend] WARNING: Contracts not detected after ${MAX_ATTEMPTS}s. Starting anyway."
fi

# Start Fastify
exec node packages/backend/fastify/server.js
