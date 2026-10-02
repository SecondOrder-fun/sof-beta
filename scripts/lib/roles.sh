#!/usr/bin/env bash
# scripts/lib/roles.sh — shared helpers for the role scripts
# (grant-backend-wallet.sh, revoke-sma-roles.sh). Source it; needs `cast` and `node`.
# Plain bash 3.2 (the macOS default): no ${x,,}, no associative arrays.

ZERO_ADDRESS="0x0000000000000000000000000000000000000000"

# lower STRING — STRING in lower case.
lower() { printf '%s' "$1" | tr 'A-F' 'a-f'; }

# read_env_value FILE KEY — one KEY=value from an env file, without sourcing
# the rest of it. Prints nothing when the file or key is missing.
read_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  { grep -E "^${key}=" "$file" || true; } | tail -1 | cut -d= -f2- | tr -d "\"' \r\n"
}

# deployment_address DEPLOYMENTS_JSON KEY — prints .contracts.KEY from the
# deployments file. Returns 1, with the reason on stderr, when it is missing,
# malformed or the zero address.
deployment_address() {
  local file="$1" key="$2" addr
  addr="$(node -e "const d=require(process.argv[1]); process.stdout.write((d.contracts||{})[process.argv[2]]||'')" "$file" "$key")" || return 1
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || [ "$(lower "$addr")" = "$ZERO_ADDRESS" ]; then
    echo "✗ No valid $key address in $file (got: ${addr:-nothing})" >&2
    return 1
  fi
  printf '%s' "$addr"
}

# load_private_key ENV_FILE — sets PRIVATE_KEY (the deployer) from the
# environment, else from ENV_FILE, with the 0x prefix forge's vm.envUint needs.
# Returns 1, with the reason on stderr, when it is missing or malformed.
load_private_key() {
  PRIVATE_KEY="${PRIVATE_KEY:-$(read_env_value "$1" PRIVATE_KEY)}"
  if [ -z "$PRIVATE_KEY" ]; then
    echo "✗ PRIVATE_KEY (deployer) not set and not found in $1" >&2
    return 1
  fi
  [[ "$PRIVATE_KEY" == 0x* ]] || PRIVATE_KEY="0x$PRIVATE_KEY"
  if [[ ! "$PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "✗ PRIVATE_KEY is malformed (expected 64 hex chars)" >&2
    return 1
  fi
}

# role_read CONTRACT ROLE ACCOUNT RPC_URL — prints true/false and returns 0.
# Only cast's stdout is parsed; its stderr (warnings, or the error on a failed
# call) passes through. A failed or odd read returns 1, so a caller can never
# mistake a read error for "not held".
role_read() {
  local out
  out="$(cast call "$1" 'hasRole(bytes32,address)(bool)' "$2" "$3" --rpc-url "$4")" || return 1
  case "$out" in
    true|false) printf '%s' "$out" ;;
    *) echo "unexpected hasRole result from $1: $out" >&2; return 1 ;;
  esac
}

# role_read_retry CONTRACT ROLE ACCOUNT RPC_URL — role_read, tried up to 3
# times 2s apart, so one transient RPC error does not abort a run. Each failed
# read's error passes through on stderr.
role_read_retry() {
  local attempt
  for attempt in 1 2 3; do
    role_read "$@" && return 0
    if [ "$attempt" -lt 3 ]; then
      echo "  (read failed; retrying)" >&2
      sleep 2
    fi
  done
  return 1
}

# role_admin_read_retry CONTRACT ROLE RPC_URL — prints getRoleAdmin(ROLE) as
# 0x + 64 hex, tried up to 3 times 2s apart like role_read_retry. Returns 1 if
# no read gives a well-formed value; each failure's reason is on stderr.
role_admin_read_retry() {
  local attempt out
  for attempt in 1 2 3; do
    if out="$(cast call "$1" 'getRoleAdmin(bytes32)(bytes32)' "$2" --rpc-url "$3")"; then
      if [[ "$out" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        printf '%s' "$out"
        return 0
      fi
      echo "unexpected getRoleAdmin result from $1: $out" >&2
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "  (read failed; retrying)" >&2
      sleep 2
    fi
  done
  return 1
}

# role_wait CONTRACT ROLE ACCOUNT RPC_URL WANT [TRIES] — after a send, the
# gateway can answer from a node one block behind, or a read can fail
# transiently: read up to TRIES times (default 5), 3s apart, until the role
# reads WANT (true|false). Returns 0 once it does. Otherwise prints why on
# stderr and returns 1 when the last value read was not WANT, or 3 when no
# read succeeded (with the last read error). cast's stderr is kept apart from
# the value, so a warning can never be mistaken for it. Use as
#   rc=0; why="$(role_wait … 2>&1)" || rc=$?
role_wait() {
  local want="$5" tries="${6:-5}" attempt=1 res last_value="" last_err="" errfile
  errfile="$(mktemp)"
  while [ "$attempt" -le "$tries" ]; do
    if res="$(role_read "$1" "$2" "$3" "$4" 2>"$errfile")"; then
      if [ "$res" = "$want" ]; then
        rm -f "$errfile"
        return 0
      fi
      last_value="$res"
    else
      last_err="$(tr '\n' ' ' < "$errfile" | sed 's/ *$//')"
    fi
    [ "$attempt" -lt "$tries" ] && sleep 3
    attempt=$((attempt + 1))
  done
  rm -f "$errfile"
  if [ -n "$last_value" ]; then
    echo "still reads as $last_value after $tries read(s)" >&2
    return 1
  fi
  echo "could not be read after $tries tries: ${last_err:-no error output}" >&2
  return 3
}
