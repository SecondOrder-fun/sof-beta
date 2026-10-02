#!/usr/bin/env bash
# scripts/lib/roles.sh — shared helpers for the role scripts
# (grant-backend-wallet.sh, revoke-sma-roles.sh). Source it; needs `cast`.
# Plain bash 3.2 (the macOS default): no ${x,,}, no associative arrays.

# read_env_value FILE KEY — one KEY=value from an env file, without sourcing
# the rest of it. Prints nothing when the file or key is missing.
read_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  { grep -E "^${key}=" "$file" || true; } | tail -1 | cut -d= -f2- | tr -d "\"' \r\n"
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

# role_wait CONTRACT ROLE ACCOUNT RPC_URL WANT — after a send, the gateway can
# answer from a node one block behind, or a read can fail transiently: read up
# to 5 times, 3s apart, until the role reads WANT (true|false). Returns 0 once
# it does. Otherwise returns 1 and prints why on stderr: the last value read,
# or — if no read succeeded — the last read error. Use as
#   if ! why="$(role_wait … 2>&1)"; then …; fi
role_wait() {
  local want="$5" attempt res last_value="" last_err=""
  for attempt in 1 2 3 4 5; do
    if res="$(role_read "$1" "$2" "$3" "$4" 2>&1)"; then
      res="${res##*$'\n'}"   # any cast warnings come first; the value is last
      [ "$res" = "$want" ] && return 0
      last_value="$res"
    else
      last_err="$res"
    fi
    [ "$attempt" -lt 5 ] && sleep 3
  done
  if [ -n "$last_value" ]; then
    echo "still reads as $last_value after 5 reads" >&2
  else
    echo "could not be read after 5 tries: $last_err" >&2
  fi
  return 1
}
