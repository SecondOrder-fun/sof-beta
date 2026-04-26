# Paymaster Verifying-Signer Rotation Playbook

**Audience:** on-call engineers responding to a leaked or suspected-leaked verifying-signer key.
**Outcome:** old key revoked on-chain, new key in service, sponsored UserOps continue with at most a few seconds of downtime.

This document covers the operational procedure. The hardening that makes a leak survivable (bounded `validUntil`, gas caps, per-EOA quota) is documented in [`gasless-transactions.md`](./gasless-transactions.md) and implemented in [`packages/backend/shared/aa/bundler.js`](../../packages/backend/shared/aa/bundler.js) and [`packages/contracts/src/paymaster/SOFPaymaster.sol`](../../packages/contracts/src/paymaster/SOFPaymaster.sol).

---

## 0. Before you begin

Resolve these in the first 60 seconds. If any are missing the rotation can't proceed:

- [ ] Owner-key holder paged and reachable. The owner is set in `15_DeployPaymaster.s.sol` and stored in the deployment file under `contracts.PaymasterOwner` — page that human (or convene the multisig quorum) before anything else.
- [ ] `$RPC_URL` resolved. For testnet/mainnet pull from `packages/contracts/env/.env.${NETWORK}` (`BASE_SEPOLIA_RPC_URL` / `BASE_RPC_URL`). For local, `http://127.0.0.1:8545`.
- [ ] `$PAYMASTER` resolved from the canonical deployment file: `jq -r '.contracts.Paymaster' packages/contracts/deployments/${NETWORK}.json`. Pull the latest `main` first — a stale local checkout points at a stale paymaster.
- [ ] `railway` CLI authenticated (`railway whoami`) and pointed at the right project (`railway status`).
- [ ] `cast` available (`cast --version`); `--ledger` / `--trezor` flags pre-tested if owner is on a hardware wallet (do not first-test under incident pressure).

---

## 1. Threat model recap

Two keys protect the paymaster:

| Key | What it controls | Where it lives | Rotation surface |
|---|---|---|---|
| **verifyingSigner** | Signs ERC-7677 paymaster responses. The contract recovers this address and rejects sigs that don't match. | Backend env: `BACKEND_WALLET_PRIVATE_KEY` | `SOFPaymaster.setSigner(address)` — `onlyOwner` |
| **owner** | Can call `setSigner` and `withdrawTo` (drain deposit). | Cold storage / hardware wallet | Constructor arg only — to rotate, deploy a new paymaster |

A leaked verifyingSigner is the **routine** rotation case (this runbook). A leaked owner is a **redeploy** case — see §6.

### Blast radius of a leaked verifyingSigner

With the Phase 1+2 hardening in production (REMOTE network config):

- Each signature is bound to its userOp (sender, nonce, callData, gas fields, paymasterAddress, chainId, validUntil, validAfter) — see [`SOFPaymaster.getHash`](../../packages/contracts/src/paymaster/SOFPaymaster.sol). Replay across userOps is impossible.
- Each signature is valid for `PAYMASTER_VALIDITY_WINDOW_SEC` seconds (default 600s on testnet/mainnet). After expiry the sig is rejected with AA22.
- An attacker with the leaked key cannot mint sigs at unlimited rate — the on-chain side imposes no quota, but per-op deposit drain is bounded by `actualGasUsed × maxFeePerGas`, where `actualGasUsed ≤ preVerificationGas + verificationGasLimit + callGasLimit + paymasterVerificationGasLimit + paymasterPostOpGasLimit`. With Phase 2 + Phase 4 REMOTE caps, all five fields are bounded by `assertGasLimitsWithinCaps`, so the per-op ceiling is **firmly** ~2.91M gas (150k + 500k + 2M + 200k + 60k).
- Per-EOA quota does **not** apply to the attacker because they sign sigs for arbitrary senders; quota gates *our backend's* sponsorship endpoint, not on-chain validation.

So the realistic loss window is `validityWindowSec × (~2.91M gas × maxFeePerGas) × (number of distinct EOAs the attacker can fund-and-execute)`. At 600s window, ~2.91M gas/op, 0.05 gwei on Base = ~0.000146 ETH/op, the attacker would need ~6,800 ops in 10 minutes to drain 1 ETH. Detect-and-rotate within 10 minutes and the leak is survivable.

---

## 2. Detection

Treat any of the following as **act-immediately** signals:

- **Deposit drain rate** > 5× baseline. Watch via Grafana panel `paymaster.deposit_balance` (delta over 5m). Baseline is whatever your normal sponsored-op rate produces.
- Backend log: `[bundler] PAYMASTER_VALIDITY_WINDOW_SEC=0 on non-local network` — means someone deployed with the override misset; not a leak per se but get it fixed before a real one happens.
- Any `SignerUpdated` event on `SOFPaymaster` that **you didn't initiate**. The owner key is compromised — go to §6.
- External tip (security report, code-leak board, CI artifact accidentally committed).

Suspicion is enough. **A precautionary rotation is cheap (~30 seconds of failed-sig blips); a delayed rotation is not.**

---

## 3. Rotation procedure (verifyingSigner only)

Total wall-clock: ~5 minutes including verification. Estimated user-visible impact: ≤ 30s of `AA34 signature error` for in-flight UserOps signed before rotation; clients retry transparently.

### 3.1 Generate new key offline

```bash
# On a clean offline machine, never piped through pastebins/Slack/etc.
cast wallet new --json | tee new-relay-key.json
```

Output is `{ address, private_key }`. The address goes on-chain in step 3.2; the private key goes in Railway env in step 3.3.

### 3.2 Update `verifyingSigner` on-chain (owner)

From the **owner wallet** (hardware-signed or multisig-quorum, never the leaked relay key):

```bash
# Resolve the deployed paymaster address
NETWORK=testnet  # or mainnet
PAYMASTER=$(jq -r '.contracts.Paymaster' packages/contracts/deployments/${NETWORK}.json)
NEW_SIGNER=$(jq -r '.address' new-relay-key.json)

# Send setSigner(newSigner) — only the owner can do this
cast send $PAYMASTER "setSigner(address)" $NEW_SIGNER \
  --rpc-url $RPC_URL \
  --private-key $OWNER_PK   # or use --ledger / --trezor / multisig path
```

Wait for **1 block on Base** (~2s — Base's reorg risk is negligible at the timescale of a key rotation). Confirm via the emitted `SignerUpdated(oldSigner, newSigner)` event:

```bash
HEAD=$(cast block-number --rpc-url $RPC_URL)
cast logs --address $PAYMASTER \
  --from-block $((HEAD - 10)) \
  "SignerUpdated(address,address)" \
  --rpc-url $RPC_URL
```

**At this moment:** old sigs already in-flight will fail (contract validates against new signer; bundler is still signing with old key). Up to ~30 seconds of AA34 errors expected. The bundler hasn't switched yet — that's step 3.3.

### 3.3 Update backend `BACKEND_WALLET_PRIVATE_KEY`

`deploy-env.sh` syncs the entire env file (no per-key filter), so update the source file first, then dry-run, then push:

```bash
# 1. Edit the network env file in your local checkout. The value must be a
#    raw 0x-prefixed 32-byte hex with no surrounding quotes / whitespace —
#    deploy-env.sh propagates exactly what's in the file.
$EDITOR packages/backend/env/.env.${NETWORK}
#    Set: BACKEND_WALLET_PRIVATE_KEY=$(jq -r '.private_key' new-relay-key.json)

# 2. Dry-run. Confirm the diff Vercel + Railway will apply contains ONLY the
#    relay-key change. Anything else is a sign you have unrelated edits in
#    the env file — abort and clean up before pushing.
./scripts/deploy-env.sh --network ${NETWORK} --dry-run

# 3. Apply for real
./scripts/deploy-env.sh --network ${NETWORK}

# 4. Force a fresh boot. Railway USUALLY restarts on env-var change, but
#    behaviour depends on service config and is not contractual. Don't
#    assume — make it explicit:
railway redeploy

# 5. Confirm the container actually rebooted (timestamp newer than step 3):
railway logs --tail 50 | grep -E "starting|listening|ready"
```

The bundler service rebuilds at boot (`createBundlerService` reads `BACKEND_WALLET_PRIVATE_KEY` from `process.env`), so the new key is live the moment the container reaches `ready`. If you see no fresh boot timestamp, something is wrong with the redeploy — pause here and triage before §3.4.

### 3.4 Verify the rotation took

Three checks, in order. If any fail, **stop and triage** before declaring success.

**a. Bundler signs with the new address.** From a developer machine:

```bash
# Hit the testnet/mainnet paymaster RPC with a probe userOp; the response's
# paymasterData embeds a signature that recovers to the verifying signer.
node scripts/verify-paymaster-signer.js \
  --rpc <paymaster RPC URL for ${NETWORK}> \
  --paymaster ${PAYMASTER} \
  --chain-id <chainId> \
  --expect-signer ${NEW_SIGNER} \
  [--sender <known-clean EOA>]   # required on testnet/mainnet if the default Anvil-#4 sender is rejected by the upstream bundler
```

(Script lives in [`scripts/verify-paymaster-signer.js`](../../scripts/verify-paymaster-signer.js); recovers the signer from a `pm_getPaymasterStubData` response and asserts equality. Exit code 0 = match, 1 = mismatch.)

**b. A real sponsored UserOp lands.** Run the headless E2E against the rotated environment if available, or send a small no-op via the UI:

```bash
# Local-shaped probe — adjust RPC and contract addresses for testnet
node scripts/test-aa-e2e.js
```

**c. No lingering AA34s.** Check Railway logs for the past 5 minutes:

```bash
railway logs --tail 500 | grep -E "AA34|AA22"
```

If AA34s persist beyond ~60s after step 3.3 completed, something is wrong — the bundler might be running an old container, or `setSigner` reverted. Re-confirm both before taking further action.

### 3.5 Post-rotation cleanup

- Move the leaked `private_key` value to your incident vault marked `revoked-${timestamp}`. Do **not** delete it — you may need to forensically inspect what the attacker did.
- Wipe `new-relay-key.json` from the offline machine.
- Update the incident log (`docs/incidents/${date}-paymaster-leak.md` — create if first time).
- File a post-mortem ticket. At minimum: how did the leak happen, what's the detection-to-rotation latency, what would have made it shorter.

---

## 4. Rollback

If the rotation went wrong (e.g., wrong key pushed to Railway, bundler service won't boot), roll back:

> **Pre-condition:** rollback returns the **compromised** key to service. This is acceptable ONLY when `PAYMASTER_VALIDITY_WINDOW_SEC > 0` so incremental damage is bounded by one window. If the env override is `0` (unbounded sigs), do **not** rollback — fix-forward by deploying a fresh new key, accepting the brief outage.

1. `cast send $PAYMASTER "setSigner(address)" $OLD_SIGNER` — flip the contract back. Old key still works as a stopgap because the leak window is bounded by `validityWindowSec` and you're now actively responding.
2. Push `OLD_SIGNER`'s private key back to Railway via `deploy-env.sh`, then `railway redeploy`.
3. Diagnose the new key (wrong format? old `0x` prefix? wallet address mismatch?) and retry §3 from scratch.

The window during which the old (compromised) key is back in service should be measured in minutes. **Do not** treat rollback as a stable state.

---

## 5. Configuration knobs that affect rotation

These live in env vars consumed by the backend; tune them based on incident-response capacity.

| Env var | Default (LOCAL) | Default (REMOTE) | Effect |
|---|---|---|---|
| `PAYMASTER_VALIDITY_WINDOW_SEC` | `0` (unbounded) | `600` (10 min) | Smaller = shorter blast radius after leak; too small = legit users see AA22 if their wallet popup takes longer than the window. |
| `PAYMASTER_QUOTA_PER_HOUR` | `0` (disabled) | `40` (≈20 user-ops/hr) | Per-EOA cap; doesn't directly slow an attacker (they pick the sender), but caps damage from accidental leaks where your own backend is the source of unauthorised sigs. |
| `PAYMASTER_MAX_CALL_GAS` | `8_000_000` | `2_000_000` | Per-op deposit-drain cap. Lower means each fraudulent op costs the attacker less but also constrains legit ops; tune to the largest legit user op (currently `createSeason` ~1.8M). |
| `PAYMASTER_MAX_PRE_VERIFICATION_GAS` | `200_000` | `150_000` | Caps the userOp's `preVerificationGas` claim. Real ops need ~50-100k; the cap is roughly 2× headroom. Closes a gap where a leaked sig key could otherwise inflate per-op damage by claiming arbitrary preVerificationGas. |

After changing any of these, restart the backend so `createBundlerService` re-reads them. There is no hot-reload — the values are captured in closure at construction time. See the comment at [`packages/backend/shared/aa/bundler.js`](../../packages/backend/shared/aa/bundler.js) `DEFAULT_VALIDITY_WINDOW_SECONDS`.

---

## 6. Owner key compromise (redeploy)

If the **owner** key is compromised, `setSigner` rotation alone is insufficient — the attacker can rotate it back, or call `withdrawTo` and drain the deposit directly. The procedure is to deploy a new paymaster and migrate.

**Sketch (escalate to the contracts engineer before executing):**

1. **Drain the deposit before the attacker does.** This is step 1 because every second matters. From the owner key (which you still hold; the attacker also holds it):

   ```bash
   TREASURY=$(jq -r '.contracts.Treasury' packages/contracts/deployments/${NETWORK}.json)
   DEPOSIT=$(cast call $PAYMASTER "getDeposit()(uint256)" --rpc-url $RPC_URL)
   cast send $PAYMASTER "withdrawTo(address,uint256)" $TREASURY $DEPOSIT \
     --rpc-url $RPC_URL --private-key $OWNER_PK
   ```

   If the attacker beats you to it, the deposit is gone. Move to step 2 anyway — preventing future damage matters even if past damage is realised.

2. **Throttling note (read this carefully):** setting `PAYMASTER_QUOTA_PER_HOUR=1` will limit *backend-originated* sponsorship — useful if the leak is via your own infrastructure. It does **not** slow an attacker who is signing sigs themselves with the leaked owner key (they don't go through your bundler). Apply it as belt-and-braces, but do not rely on it for stopping the attack.

3. From a fresh (uncompromised) deployer key, deploy a new `SOFPaymaster` via `15_DeployPaymaster.s.sol`. Update `deployments/${network}.json`.

4. Fund the new paymaster: `cast send $NEW_PAYMASTER "deposit()" --value <amount> --rpc-url $RPC_URL --private-key $DEPLOYER_PK`.

5. Push the new paymaster address to Railway (`PAYMASTER_ADDRESS`) via `deploy-env.sh` and `railway redeploy`. Verify with `verify-paymaster-signer.js` against the new paymaster.

6. Frontend: re-export ABIs is unnecessary (interface unchanged), but the deployment file change will propagate via `@sof/contracts/deployments`. Trigger a Vercel redeploy so the frontend picks up the new `deployments/${network}.json`.

---

## 7. Drill / test in pre-prod

Run this rotation against the testnet paymaster **at least once per quarter**. The drill catches:

- Stale ownership (e.g., owner key holder rotated off the team)
- Broken `deploy-env.sh` env-push automation
- Missing Grafana panels for detection
- A `verify-paymaster-signer.js` script that doesn't match the current digest scheme

A drill that fails to complete in under 10 minutes is a process bug — fix the doc or the tooling, not the timer.

---

## 8. References

- [`packages/contracts/src/paymaster/SOFPaymaster.sol`](../../packages/contracts/src/paymaster/SOFPaymaster.sol) — `setSigner`, `withdrawTo`, `SignerUpdated` event, `getHash` digest scheme
- [`packages/backend/shared/aa/bundler.js`](../../packages/backend/shared/aa/bundler.js) — `createBundlerService`, validity-window + gas-cap + quota config
- [`packages/backend/shared/aa/paymasterSigner.js`](../../packages/backend/shared/aa/paymasterSigner.js) — `buildPaymasterResponse` (off-chain digest mirror)
- [`packages/backend/fastify/routes/localBundlerRoutes.js`](../../packages/backend/fastify/routes/localBundlerRoutes.js) — current production-ready route (LOCAL gate; testnet wire-up tracked in `instructions/project-tasks.md` Task #41)
- [`scripts/deploy-env.sh`](../../scripts/deploy-env.sh) — env push to Railway/Vercel
- [`scripts/test-aa-e2e.js`](../../scripts/test-aa-e2e.js) — headless sponsored-UserOp probe
