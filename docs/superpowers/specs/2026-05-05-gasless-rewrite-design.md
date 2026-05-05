# Gasless Transactions Rewrite — Design

**Date:** 2026-05-05
**Status:** approved, ready for implementation plan
**Scope:** desktop EOA wallets (MetaMask, Rabby, Brave, etc.). Coinbase Smart Wallet and Farcaster MiniApp unchanged.

## 1. Problem statement

The existing gasless flow assumed users would delegate their EOA to `SOFSmartAccount` via EIP-7702 and the backend would relay the signed authorization on-chain. That works on local Anvil because the backend uses `anvil_setCode` to inject the 0xef0100 designator without needing a real signature. On testnet/mainnet there is no such shortcut: the user's wallet must produce a real EIP-7702 authorization, and **viem's `signAuthorization` rejects JSON-RPC accounts** (every browser-extension wallet falls in this category). MetaMask, Rabby, and other major EOA wallets do not expose any RPC method that lets a dapp request a 7702 authorization for an arbitrary delegate; their internal 7702 path delegates only to their own audited contracts. ERC-7902 (the standard that would close this gap) is in draft and has no reference implementations.

Consequence: sponsorship has never worked end-to-end on testnet for any browser EOA wallet. We need a different architecture.

References for the constraint:
- viem maintainer's position: [wevm/viem discussion #3285](https://github.com/wevm/viem/discussions/3285) — "It is not possible to sign an authorization over JSON-RPC right now, so it won't be added into Viem until there is an ERC for it."
- MetaMask docs explicitly state `signAuthorization` doesn't support JSON-RPC accounts.
- Pimlico's external-wallets guide does not attempt 7702 signing from a browser wallet — it relies on the wallet's own internal 7702 path.

## 2. Decision summary

| Decision | Choice |
|---|---|
| Architecture | **Counterfactual ERC-4337 smart account, EOA-owned (non-custodial)** |
| Per-EOA salt | `salt = keccak256(abi.encodePacked(owner))` — one SMA per EOA |
| Smart account upgradeability | Immutable factory + immutable implementation in v1 |
| Signing pattern | EIP-712 wrap of the userOpHash (Coinbase Smart Wallet style); per-action EIP-712 documented as future work |
| Paymaster allowlist mechanism | Static allowlist for fixed contracts + dynamic `raffle.isSofCurve(target)` check for per-season curves |
| Admin actions | Bypass the SMA layer; admin EOAs sign normal `eth_sendTransaction` and pay gas (rare actions) |
| Initial funding | Backend airdrop relayer transfers SOF directly to user's SMA on first auth (Sepolia: free; mainnet: cost center, separate decision) |
| Username system | Continues to bind to EOA; resolution path becomes username → EOA → derived SMA |
| Send-to-EOA semantics | Always resolves to recipient's deterministic SMA; "sweep" tool offered if recipient EOA holds legacy SOF |
| Returning-user banner | Once per device (localStorage flag) |
| Admin flag enforcement | Backend-enforced `is_admin` on `users` table, plus existing on-chain role check (defense in depth) |
| `permissionless.js` | Already a dependency (`^0.3.4` in `packages/frontend/package.json`); just import it |
| `SOFAirdrop.sol` (merkle drop) | Deleted — keep things lean; reintroduce if a use case appears |

## 3. Architecture & contract changes

### 3.1 SOFSmartAccount.sol *(rewrite — currently 7702 delegate)*

Standard ERC-4337 v0.8 account with a single `address public immutable owner` set at construction (the public auto-generated getter is required so the paymaster can read it during validation — see §3.3). `validateUserOp` checks the UserOp signature against `owner` using **EIP-712 typed-data wrapping of the userOpHash** (mirror the Coinbase Smart Wallet pattern). `execute(target, value, data)` and `executeBatch(calls[])` permit owner-signed calls. No 7702-specific code paths.

### 3.2 SOFSmartAccountFactory.sol *(new)*

```solidity
contract SOFSmartAccountFactory {
    SOFSmartAccount public immutable accountImplementation;
    event AccountCreated(address indexed owner, address indexed account);

    constructor() {
        accountImplementation = new SOFSmartAccount();
    }

    function getAddress(address owner) external view returns (address);
    function createAccount(address owner) external returns (SOFSmartAccount);
}
```

- Salt = `keccak256(abi.encodePacked(owner))`.
- `createAccount` is idempotent: returns existing instance if already deployed; otherwise deploys with `new SOFSmartAccount{salt: salt}(owner)` and emits `AccountCreated`.
- Bundler invokes `createAccount` lazily via the `initCode` field of the user's first UserOp.

### 3.3 SOFPaymaster.sol *(re-target)*

Sponsors UserOps from accounts deployed by `SOFSmartAccountFactory`, calling allowlisted contracts. Validation logic in `validatePaymasterUserOp`:

1. Read `address smaOwner = SOFSmartAccount(userOp.sender).owner()` (uses the public getter from §3.1). Compute `address expected = factory.getAddress(smaOwner)`. Reject unless `userOp.sender == expected` — proves the SMA was deployed by our factory.
2. Decode the UserOp's first call target. Approve if either:
   - Target ∈ static allowlist `{Raffle, SOFToken, InfoFiFactory, InfoFiSettlement, InfoFiFPMM, RaffleOracleAdapter, RolloverEscrow, SOFExchange}`, OR
   - `IRaffle(raffle).isSofCurve(target) == true`.
3. If the UserOp's outermost call is `executeBatch`, decode and validate every inner call's target the same way.

Per-user rate limit / max-spend stays as-is.

Gas note: step 1 is one external call (~5k gas) plus one external view call (~2k gas — `getAddress` is pure CREATE2 math). Step 2 is one SLOAD on Raffle for curve checks (~2k gas). Total paymaster overhead ~10-15k gas per UserOp, paid by the paymaster.

### 3.4 Raffle.sol *(small extension)*

```solidity
mapping(address => bool) public sofCurves;
function registerCurve(address curve) external onlyRole(SEASON_FACTORY_ROLE);
function isSofCurve(address curve) external view returns (bool) { return sofCurves[curve]; }
```

`SEASON_FACTORY_ROLE` is a new role on `Raffle.sol`, granted at deploy time to the `SeasonFactory` contract address (since it's the SeasonFactory that calls `registerCurve` from within `createSeasonContracts`). The grant happens in `14_ConfigureRoles` deploy script.

### 3.5 SeasonFactory.sol *(one new line)*

After deploying the curve in `createSeasonContracts`, call `IRaffle(raffleAddress).registerCurve(curveAddr)`.

### 3.6 EntryPoint

Stay on v0.8 (Pimlico's current default). No change.

### 3.7 Migration

Clean redeploy on Base Sepolia. No on-chain state to preserve — testnet has been redeployed twice in the past week. Old `SOFSmartAccount` deployment becomes orphaned.

## 4. Frontend changes

### 4.1 RaffleAccountProvider *(new)*

App-level provider exposing:

```ts
const { eoa, sma, walletType, isReady } = useRaffleAccount();
// walletType ∈ { 'desktop-eoa', 'coinbase-smart', 'farcaster-miniapp' }
// For 'desktop-eoa':         eoa = 0x123…, sma = 0x456… (factory.getAddress(eoa))
// For 'coinbase-smart':      eoa = sma = the connected smart-wallet address
// For 'farcaster-miniapp':   eoa = sma = the connected mini-app address
```

Wraps the app inside `WagmiProvider`. Listens to `useAccount` for connect/disconnect, classifies the wallet (connector ID + EIP-6963 metadata), computes the SMA via `factory.getAddress(eoa)` (single `eth_call`, cached per-EOA).

### 4.2 useSmartTransactions routing

```
executeBatch(calls):
  switch (walletType):
    case 'coinbase-smart':       → wallet_sendCalls + paymaster capability       (works today, unchanged)
    case 'farcaster-miniapp':    → wallet_sendCalls + paymaster capability       (works today, unchanged)
    case 'desktop-eoa':          → permissionless.js → toSofSmartAccount         (rewrite target)
                                   → smartAccountClient.sendTransactions(calls)
                                   → user signs EIP-712 wrap of userOpHash
```

`toSofSmartAccount` is a thin adapter around `permissionless.accounts.toSimpleSmartAccount` (≈50 lines) swapping factory + ABI + signing message format for ours.

### 4.3 Read-side migration

| Hook / component | Currently reads | After |
|---|---|---|
| `useProfileData` | `balanceOf(eoa)` per season | `balanceOf(sma)` |
| `useCurveState` | `getUserPosition(eoa)` | `getUserPosition(sma)` |
| Header SOF balance | `SOF.balanceOf(eoa)` | `SOF.balanceOf(sma)` |
| Allowlist gating | check FID/EOA | unchanged (gating proves identity, not custody) |
| Admin role checks | `hasRole(RAFFLE_ADMIN, eoa)` | unchanged (admin bypass per §2) |
| Username display | EOA → username | unchanged (binds to EOA) |
| Share-target resolution | username → EOA | username → EOA → derived SMA |

### 4.4 Deletions

`WagmiConfigProvider.DelegationGate`, `DelegationModal.jsx`, `useDelegationStatus`, `useDelegatedAccount`, `useDelegatedClient`, `useSmartTransactions.needsDelegation`, the `sof:request-delegation` window event listener, the `if (needsDelegation && !isDelegated)` gates in `useBuySellTransactions`.

### 4.5 UI surfaces

**Header:** primary line shows SMA, secondary line shows owning EOA dimmed.

**First-connect banner** (one-time, dismissable per device): *"Your gameplay happens at your raffle account `0x456d…f00d`, owned by your wallet `0x1eD4…0Ff4`. You won't pay gas for raffle actions."*

**Send modal:** dual mode — username lookup (registered users) vs raw EOA input (auto-derives recipient SMA). Both result in a UserOp from the sender's SMA.

**Sweep banner:** if `SOF.balanceOf(eoa) > 0` is detected at connect, show a one-time CTA *"You have N SOF in your wallet. Move it to your raffle account?"* — clicking submits a standard `eth_sendTransaction` ERC-20 transfer (user pays gas for this, not sponsored).

## 5. Backend changes

### 5.1 Routes deleted

`packages/backend/fastify/routes/delegationRoutes.js` — the entire file. Both `/api/wallet/delegate` and `/api/wallet/delegate-shortcut`. The `/api/wallet` mount in `server.js` is removed.

### 5.2 Routes kept (unchanged)

`/api/paymaster/pimlico`, `/api/paymaster/local`, `/api/paymaster/sof`, `/api/paymaster/coinbase`, `/api/paymaster/session`. Validation logic moves to the on-chain paymaster contract; the proxies just sign / route.

### 5.3 Routes adapted

`/api/airdrop/*` — recipient resolution changes from EOA to SMA. Implementation is a simple ERC-20 `transfer` from `BACKEND_WALLET_PRIVATE_KEY`'s wallet to the SMA address; SOF is mintable on Sepolia so this is free.

### 5.4 DB schema

```sql
CREATE TABLE smart_accounts (
  eoa             TEXT PRIMARY KEY,
  sma             TEXT NOT NULL UNIQUE,
  deployed_at     TIMESTAMPTZ,
  funded_at       TIMESTAMPTZ,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_smart_accounts_sma ON smart_accounts(sma);
```

Plus add `is_admin BOOLEAN NOT NULL DEFAULT FALSE` to the `users` table (per §2 admin enforcement decision). Population: a comma-separated `ADMIN_EOAS` env var on the backend lists addresses that get `is_admin = true` on first auth; subsequent admin promotions/demotions go through a migration script. Frontend reads `is_admin` from the auth response and routes admin pages accordingly.

### 5.5 Listeners

The existing 7 on-chain event listeners are address-based and don't care whether positions live at EOAs or SMAs — no code changes required. Add one small listener for the factory's `AccountCreated(owner, account)` event that updates `smart_accounts.deployed_at`.

### 5.6 Env config

- `BACKEND_WALLET_PRIVATE_KEY` — kept for the airdrop relayer.
- `SOF_SMART_ACCOUNT` — repurposed → renamed `SOF_SMART_ACCOUNT_FACTORY` to avoid confusion.
- New: `SOF_AIRDROP_AMOUNT_PER_USER` — initial SOF balance handed to a fresh SMA on Sepolia.

## 6. User flows

### Flow A — first-time desktop user

1. Connect wallet → SIWE auth.
2. Backend computes SMA, inserts `smart_accounts` row, fires off airdrop transfer (returns 200 immediately).
3. Frontend renders dapp + one-time banner.
4. Airdrop tx confirms in 5-15s; SOF balance ticks up via existing balance polling.
5. User clicks Buy → MetaMask popup shows EIP-712 typed data with domain "SOF Smart Account", type "UserOperation", userOpHash field.
6. User signs. UserOp packs `initCode` (deploys SMA), `execute(SOF, approve(curve, MAX))`, `execute(curve, buy(...))`. Pimlico paymaster sponsors. Total user cost: zero ETH.

### Flow B — returning user

Connect → SIWE → backend finds existing `smart_accounts` row → frontend computes same SMA via factory.getAddress → balance reads come from SMA → no banner (per-device localStorage flag).

### Flow C — buy/sell/claim

One MetaMask signature popup per action, no transaction popup. `permissionless.sendTransactions` returns the on-chain tx hash; existing `TransactionModal` and `useWaitForTransactionReceipt` work unchanged.

### Flow D — send to registered user

Username → backend lookup → `{eoa, sma}` → UserOp from sender SMA: `execute(SOF, transfer(recipientSMA, amount))`.

### Flow E — send to non-registered EOA

Frontend computes recipient's deterministic SMA via `factory.getAddress(0x123…)`. UI: *"This sends to `0xabc…` — the raffle account for `0x123…`. Recipient sees tokens when they connect."* Tx targets the SMA address (not yet deployed; CREATE2 means the address is mathematically valid for ERC-20 transfers). Recipient's first action will lazy-deploy the SMA via `initCode`.

### Flow F — sweep tool

Connect detects `SOF.balanceOf(eoa) > 0` → banner offers one-click sweep. Standard ERC-20 transfer from EOA → SMA, user pays gas. Only place a desktop user pays gas after onboarding.

### Flow G — admin action

Admin connects EOA. Backend sets `is_admin: true` on auth response. Admin pages bypass `RaffleAccountProvider`'s SMA — they read `useAccount().address` directly. `useRaffleWrite` uses `walletClient.writeContract` (not `executeBatch`). Standard tx popup; admin pays gas.

### Edge cases handled

| Situation | Behavior |
|---|---|
| Airdrop tx not yet confirmed | "Funding your raffle account…" with spinner; balance reads return 0 until confirmation |
| Returning user, airdrop already happened | No banner; balance loads as normal |
| EOA already delegated by another dapp | We don't read or care about the EOA's code; we use SMA |
| SMA not yet deployed but page calls a contract method | Reads return zero; UI shows "no positions yet"; first write deploys via `initCode` |
| Network switch mid-session | `useRaffleAccount` recomputes SMA against the new chain's factory; balances re-resolve |
| User disconnects mid-UserOp | UserOp continues at the bundler; on next connect, balance reflects whatever landed |

## 7. Migration & test milestones

Each milestone is a verifiable checkpoint with concrete pass criteria. **Do not claim a milestone passed without the listed evidence.**

### M1 — Contracts compile + unit tests green

Implements §3.1–3.5. New tests:
- `SOFSmartAccountFactory.t.sol` — `getAddress == createAccount`, idempotent, emits event.
- `SOFSmartAccount.t.sol` — EIP-712 sig recovers to owner; non-owner reverts; `executeBatch` works; reentrancy guard.
- `SOFPaymaster.t.sol` — sponsors factory-deployed SMA + allowlisted target; rejects non-factory SMA; rejects non-allowlisted target; rejects unregistered curve.
- `Raffle.t.sol` — `registerCurve` only callable by SeasonFactory; `isSofCurve` correct.

Pass: `forge test` exits 0; all 24 existing tests still pass.

### M2 — Local Anvil deploy

`DeployAll.s.sol` deploys all contracts in dependency order. Factory before paymaster (paymaster constructor needs factory address). ABIs exported. `deployments/local.json` updated. Manual: `cast call $FACTORY "getAddress(address)" $TEST_EOA` returns deterministic address.

### M3 — Frontend wires up RaffleAccountProvider

Implements §4.1–4.4. Lint clean, 327+ existing tests pass, build succeeds. Manual: connect wallet on local Anvil, header shows correct SMA.

### M4 — First sponsored UserOp lands on local Anvil

`toSofSmartAccount` adapter implemented. Local bundler+paymaster accepts UserOp. Scripted scenario: fresh test EOA sends batched `[approve, dummy_call]`; `initCode` deploys SMA + calls execute in one tx.

**Stop and confirm with user before moving to real testnet.** Required evidence:
- Screenshot of MetaMask EIP-712 popup showing domain "SOF Smart Account" + userOpHash field.
- On-chain tx hash from local Anvil.
- `cast code $SMA_ADDRESS` non-empty.
- User's ETH balance unchanged.

### M5 — Full buy-flow E2E on local Anvil

Flow A end-to-end. Pass criteria:
- New `smart_accounts` row.
- Airdrop confirmed; SMA SOF balance correct.
- Buy UserOp lands; SOF decreases, ticket count increases.
- EOA ETH unchanged from start to finish.
- Screen recording or step-by-step screenshots.

### M6 — Sell + claim flows on local Anvil

All three actions complete with zero ETH cost. Withdraw-to-EOA explicitly NOT in this milestone (punted to v2).

### M7 — Deploy to Base Sepolia

`DeployAll.s.sol` against testnet using Tenderly RPC + V2 verifier (per CLAUDE.md gotchas). `extract-deployment-addresses.js` regenerates `testnet.json`. All contracts verified on Basescan. Env vars pushed via `deploy-env.sh` (dry-run first).

### M8 — Full E2E on Base Sepolia

Same scenarios as M5+M6 against real Pimlico Sepolia bundler with our deployed `SOFPaymaster`. Pass:
- Buy + sell + settlement work zero-cost.
- Pimlico dashboard shows sponsored UserOps.
- Share-by-EOA flow tested end-to-end (sender sends, recipient connects, sees balance).

### M9 — Cleanup PR

Delete `delegationRoutes.js`, the `/api/wallet` mount in `server.js`, the 7702-relayer code path. Delete `SOFAirdrop.sol` and integration. Update root `CLAUDE.md` and per-package `CLAUDE.md` files. Update `instructions/project-structure.md` and `instructions/project-requirements.md`.

## 8. Risk areas & mitigations

| Risk | Mitigation |
|---|---|
| EIP-712 wrap signature validation has a subtle bug | Mirror Coinbase Smart Wallet's audited implementation byte-for-byte; add invariant test |
| Pimlico paymaster proxy needs updates to handle our SMA factory | Verify against Pimlico's external-wallets guide before M4; if their proxy doesn't accept our paymaster, fall back to running our own bundler |
| Lazy deployment via `initCode` fails for some bundler edge case | Test on local first (M4); add a "force-deploy via factory.createAccount" admin endpoint as escape hatch |
| Backfilling existing testnet users (no positions of value, but `smart_accounts` row needs to exist) | Backfill on next-auth (lazy); no data migration script needed |
| Admin actions slip into the SMA path accidentally | Tests for `useRaffleWrite` confirming admin write hooks don't touch SMA; explicit `isAdmin` branch |

## 9. Future work (explicitly out of scope for v1)

- **Per-action EIP-712 typed data** (signing pattern 3 — wallet popup shows decoded action params instead of opaque userOpHash). Requires custom dispatch or ERC-7821 (still draft). Revisit when ERC-7821 stabilizes or a strong UX driver appears.
- **Withdraw-to-EOA** in the dapp. Punted to v2 per Section 2 decision.
- **Mainnet airdrop strategy** — Sepolia auto-fund is free, mainnet needs throttling, allowlisting, per-user caps. Separate decision when mainnet date is set.
- **Multi-account per EOA** — current salt scheme is `keccak256(eoa)` (one SMA per EOA). If users request multiple raffle accounts from one EOA, salt becomes `keccak256(eoa, accountIndex)` and UI adds an account-switcher. Not v1.
- **Smart account upgradability** — immutable in v1. If a future need arises (bug fix, feature), a new factory is deployed; existing users keep the old SMA forever. Acceptable trade-off given Safe and Coinbase Smart Wallet both ship immutable.
- **Reintroducing merkle-drop airdrop** — `SOFAirdrop.sol` deleted in v1. If a partner promo or allowlist-based drop is needed later, reintroduce as a separate contract.

## 10. What "done" looks like

When all 9 milestones pass:
- Any desktop EOA wallet (MetaMask, Rabby, Brave) gets zero-gas raffle gameplay.
- Coinbase Smart Wallet works the same as today (untouched).
- Farcaster MiniApp works the same as today (untouched).
- 5+ files deleted, no orphaned 7702 plumbing.
- A user-facing doc in `instructions/` describes the SMA model so future contributors don't have to reconstruct it from git history.

---

## References

- [wevm/viem discussion #3285 — EIP-7702 JSON-RPC support](https://github.com/wevm/viem/discussions/3285)
- [MetaMask EIP-7702 quickstart](https://docs.metamask.io/smart-accounts-kit/get-started/smart-account-quickstart/eip7702/)
- [Pimlico external-wallets EIP-7702 guide](https://docs.pimlico.io/guides/eip7702/external)
- [ERC-7902 (draft)](https://eips.ethereum.org/EIPS/eip-7902)
- [Coinbase Smart Wallet contracts](https://github.com/coinbase/smart-wallet) — reference for EIP-712 wrap pattern
- [Pimlico permissionless.js docs](https://docs.pimlico.io/permissionless)
- Project memory: `feedback_invoke_skills_first.md`, `reference_wagmi_useCapabilities.md`
