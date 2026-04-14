#!/bin/sh
# Docker backend startup script
# Waits for contracts to be deployed on Anvil, then starts Fastify

RAFFLE_ADDRESS="${RAFFLE_ADDRESS:-0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9}"
RPC_URL="${RPC_URL:-http://anvil:8545}"

echo "[backend] Waiting for contracts to be deployed on $RPC_URL..."

# Poll until the Raffle contract has code (contracts deployed)
ATTEMPTS=0
MAX_ATTEMPTS=120  # 2 minutes
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  # Use node to check if contract has code (cast not available in node:alpine)
  CODE=$(node -e "
    fetch('$RPC_URL', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',method:'eth_getCode',params:['$RAFFLE_ADDRESS','latest'],id:1})
    }).then(r=>r.json()).then(d=>console.log(d.result||'0x')).catch(()=>console.log('0x'))
  " 2>/dev/null)

  if [ "$CODE" != "0x" ] && [ -n "$CODE" ] && [ ${#CODE} -gt 4 ]; then
    echo "[backend] Contracts detected on-chain. Starting Fastify..."
    break
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
