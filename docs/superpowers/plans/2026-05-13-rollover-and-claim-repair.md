# Rollover + Claim Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make consolation claims and the rollover feature actually work, end-to-end — on testnet today, and in the deployment pipeline going forward.

**Architecture:** Three structural gaps exist between the contracts as designed and the contracts as wired:

1. `RafflePrizeDistributor` is missing from the `SOFPaymaster` static allowlist, so every gasless claim reverts at `validatePaymasterUserOp` with `TargetNotAllowed(distributor)`.
2. `Raffle.pokeConsolationEligible` is never called by production code, so the eligibility map for every season is empty and `claimConsolation` always reverts `NotAParticipant`.
3. `RolloverEscrow.openCohort` is never called, so `cohortPhase === "none"` for every season and rollover UI is hidden.

We close (1) in the deploy script and via a one-off `cast send` on testnet (already applied), close (2) by extending the backend `seasonLifecycleService` to poke eligibility in chunks after `finalizeSeason` confirms, and close (3) by having `Raffle._executeFinalization` call `RolloverEscrow.openCohort` directly on-chain. We then surface the green-box rollover/claim UI on the Completed Raffle detail page via a shared `ConsolationClaimAction` component.

**Tech Stack:** Solidity `^0.8.20` / Foundry, Node.js / Fastify backend, React 18 / wagmi v2 / @tanstack/react-query frontend, ERC-4337 (EntryPoint v0.8) + ERC-7821 + ERC-5792 gasless stack.

**Scope decisions (locked):**

- Paymaster allowlist: code fix in `15_DeployPaymaster.s.sol` initialAllowlist + defensive `setAllowlisted` in `DeployAll.s.sol`. Cast-send patch already applied to live testnet paymaster.
- `openCohort`: wired into `Raffle._executeFinalization`. Raffle holds `DEFAULT_ADMIN_ROLE` on RolloverEscrow.
- `pokeConsolationEligible`: backend orchestration in `seasonLifecycleService.finalizeSeason`, chunked (500 per call) for OOG safety. Not on-chain because the original architects extracted it from `_executeFinalization` exactly to avoid the OOG ceiling at ~1500 participants.
- Detail-page UI: extract `ConsolationClaimAction` shared component and reuse it in `CompletedRaffleResults.jsx`.
- Pre-deploy alpha: contract redeploy is acceptable; no migration shims.

**Architectural note on Raffle ↔ RolloverEscrow coupling:** `Raffle._executeFinalization` calling `RolloverEscrow.openCohort` introduces a one-way dependency from Raffle to RolloverEscrow. We guard it with `if (rolloverEscrow != address(0))` so old deployments without rollover keep working — same pattern Raffle already uses for `gatingContract` and `prizeDistributor`.

**Live testnet remediation already applied** (this PR's structural fix supersedes these for future seasons):

- `cast send paymaster.setAllowlisted(prizeDistributor, true)` — tx `0x49a3441d...083b0e`
- `cast send raffle.pokeConsolationEligible(3, 0, 1000)` — tx `0xb28a8cd3...5b806`
- `cast send rolloverEscrow.openCohort(3, 0)` — tx `0x71ea652d...b1b36`

End-to-end validated on testnet: Player 3 rollover claim (escrow holds 21 SOF), Player 1 wallet claim (tx `0x4f820e89...18c`).

---

## Files touched

**Contracts**
- Modify `packages/contracts/src/core/Raffle.sol` — add `IRolloverEscrow rolloverEscrow` state + setter + call in `_executeFinalization`
- Modify `packages/contracts/src/core/IRolloverEscrow.sol` — expose `openCohort` in the interface if not already there
- Modify `packages/contracts/script/deploy/15_DeployPaymaster.s.sol` — add `prizeDistributor` to initialAllowlist
- Modify `packages/contracts/script/deploy/DeployAll.s.sol` — defensive `setAllowlisted(prizeDistributor)`, grant `DEFAULT_ADMIN_ROLE` on RolloverEscrow to Raffle, call `raffle.setRolloverEscrow`
- Modify `packages/contracts/script/deploy/14_ConfigureRoles.s.sol` — mirror the same wiring
- Modify `packages/contracts/package.json` — version bump
- Create `packages/contracts/test/RaffleOpenCohortIntegration.t.sol` — new test
- Modify `packages/contracts/test/RolloverIntegration.t.sol` — extract a shared test base if needed

**Backend**
- Modify `packages/backend/src/services/seasonLifecycleService.js` — generalize `submitWithRetry`, add `pokeConsolationEligibleChunked` step after `finalizeSeason`
- Create `packages/backend/tests/services/seasonLifecycleService.poke.test.js`
- Modify `packages/backend/package.json` — version bump

**Frontend**
- Create `packages/frontend/src/components/raffle/ConsolationClaimAction.jsx` — extracted shared component
- Modify `packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx` — use the new shared component
- Modify `packages/frontend/src/components/raffle/CompletedRaffleResults.jsx` — render `ConsolationClaimAction` for eligible non-winners
- Modify `packages/frontend/src/routes/RaffleDetails.jsx` — thread viewerClaimable amount + claimRaffleConsolation mutation
- Create `packages/frontend/tests/components/ConsolationClaimAction.test.jsx`
- Modify `packages/frontend/tests/components/CompletedRaffleResults.test.jsx` — extend with eligible-non-winner case
- Modify `packages/frontend/package.json` — version bump

---

## Task 1 — Branch + plan commit (this commit)

**Files:**
- Create: `docs/superpowers/plans/2026-05-13-rollover-and-claim-repair.md` (this file)

- [x] Phase 1 of github-pr-workflow: fetched origin, branched from `origin/main`
- [x] Saved this plan to the path above
- [ ] First commit + push + open draft PR

---

## Task 2 — Contract: paymaster allowlist code fix

**Files:**
- Modify: `packages/contracts/script/deploy/15_DeployPaymaster.s.sol:38-58`
- Modify: `packages/contracts/script/deploy/DeployAll.s.sol:117-129`

- [ ] **Step 2.1: Read the current allowlist initializer**

```bash
sed -n '36,70p' packages/contracts/script/deploy/15_DeployPaymaster.s.sol
```

- [ ] **Step 2.2: Add `prizeDistributor` to the initial allowlist**

In `15_DeployPaymaster.s.sol`, change the allowlist array size from 6 to 7 and add the distributor. PrizeDistributor is deployed at step 11 (`addrs.prizeDistributor` is non-zero by step 15), so this is safe.

```solidity
address[] memory initialAllowlist = new address[](7);
initialAllowlist[0] = addrs.raffle;
initialAllowlist[1] = addrs.sofToken;
initialAllowlist[2] = addrs.infoFiFactory;
initialAllowlist[3] = addrs.infoFiSettlement;
initialAllowlist[4] = addrs.fpmmManager;
initialAllowlist[5] = addrs.oracleAdapter;
initialAllowlist[6] = addrs.prizeDistributor;
```

Also update the comment block at lines 37-50 to add `RafflePrizeDistributor` to the listed targets (the comment currently enumerates 8 spec targets and omits the distributor).

- [ ] **Step 2.3: Add defensive `setAllowlisted` for prizeDistributor in `DeployAll.s.sol`**

In the existing 18b block (`DeployAll.s.sol:117-129`), add:

```solidity
// Defensive: heal existing paymaster deployments that predate the
// prizeDistributor allowlist entry (see 15_DeployPaymaster.s.sol).
if (addrs.prizeDistributor != address(0)) {
    paymaster.setAllowlisted(addrs.prizeDistributor, true);
    console2.log("Allowlisted RafflePrizeDistributor on Paymaster (defensive)");
}
```

- [ ] **Step 2.4: Verify it builds**

```bash
cd packages/contracts && forge build 2>&1 | tail -5
```

Expected: `Compiler run successful!`

- [ ] **Step 2.5: Commit**

```bash
git add packages/contracts/script/deploy/15_DeployPaymaster.s.sol packages/contracts/script/deploy/DeployAll.s.sol
git commit -m "fix(contracts): include RafflePrizeDistributor in paymaster allowlist

Every gasless claim call (claimGrand, claimConsolation, claimSponsored*)
targets RafflePrizeDistributor, which was missing from the spec §3.3
static allowlist. validatePaymasterUserOp reverted TargetNotAllowed for
every claim post-M9 gasless rewrite. Add the distributor to the
initialAllowlist in 15_DeployPaymaster and add a defensive
setAllowlisted call in DeployAll 18b so existing paymaster
deployments self-heal on the next DeployAll run."
```

---

## Task 3 — Contract: wire `Raffle.finalizeSeason` → `RolloverEscrow.openCohort` (TDD)

**Files:**
- Modify: `packages/contracts/src/core/Raffle.sol`
- Modify: `packages/contracts/src/core/IRolloverEscrow.sol`
- Create: `packages/contracts/test/RaffleOpenCohortIntegration.t.sol`

- [ ] **Step 3.1: Write the failing integration test**

`packages/contracts/test/RaffleOpenCohortIntegration.t.sol` — a focused test that:
- Sets up a raffle + RolloverEscrow with Raffle holding `DEFAULT_ADMIN_ROLE` on the escrow
- Advances a season to `Distributing` status (VRF words received)
- Asserts `getCohortState(seasonId).phase == None` pre-finalize
- Calls `raffle.finalizeSeason(seasonId)`
- Asserts `getCohortState(seasonId).phase == Open` and `bonusBps == defaultBonusBps`
- Adds a second test that unwires `rolloverEscrow` (sets to `address(0)`) and confirms `finalizeSeason` still works (the guard branch)

(If `RolloverIntegration.t.sol` already has helpers for advancing-to-Distributing, extract them into a shared `RolloverIntegrationBase` abstract contract. Otherwise duplicate the minimum setup — keep this test small.)

- [ ] **Step 3.2: Run the test to verify it fails**

```bash
cd packages/contracts && forge test --match-contract RaffleOpenCohortOnFinalize -vvv
```

Expected: FAIL — phase stays `None` after `finalizeSeason`.

- [ ] **Step 3.3: Add `openCohort` to `IRolloverEscrow.sol` if missing**

```bash
grep -n "openCohort" packages/contracts/src/core/IRolloverEscrow.sol
```

If absent, add:

```solidity
function openCohort(uint256 seasonId, uint16 bonusBps) external;
function defaultBonusBps() external view returns (uint16);
```

- [ ] **Step 3.4: Add `rolloverEscrow` state + setter to `Raffle.sol`**

Near existing distributor wiring:

```solidity
import {IRolloverEscrow} from "./IRolloverEscrow.sol";

IRolloverEscrow public rolloverEscrow;

event RolloverEscrowUpdated(address indexed previous, address indexed current);

function setRolloverEscrow(address _rolloverEscrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
    emit RolloverEscrowUpdated(address(rolloverEscrow), _rolloverEscrow);
    rolloverEscrow = IRolloverEscrow(_rolloverEscrow);
}
```

Style note: follow how `Raffle.sol` already exposes `setPrizeDistributor` / `setSeasonFactory` — same `onlyRole(DEFAULT_ADMIN_ROLE)`, same event-then-assign pattern.

- [ ] **Step 3.5: Call `openCohort` inside `_executeFinalization`**

Locate `_executeFinalization` in `Raffle.sol` (the function called by `finalizeSeason`). After `fundSeason` is called and after the consolation flow is complete, append:

```solidity
// Open the rollover cohort for this season if escrow is wired.
// Permissioned: Raffle holds DEFAULT_ADMIN_ROLE on RolloverEscrow
// (granted in 14_ConfigureRoles). Passing 0 falls through to
// defaultBonusBps inside RolloverEscrow.openCohort.
if (address(rolloverEscrow) != address(0)) {
    rolloverEscrow.openCohort(seasonId, 0);
}
```

- [ ] **Step 3.6: Run the test to verify it passes**

```bash
cd packages/contracts && forge test --match-contract RaffleOpenCohortOnFinalize -vvv
```

Expected: PASS.

- [ ] **Step 3.7: Run full contracts suite**

```bash
cd packages/contracts && forge test 2>&1 | tail -30
```

Expected: all green.

- [ ] **Step 3.8: Commit**

```bash
git add packages/contracts/src/core/Raffle.sol packages/contracts/src/core/IRolloverEscrow.sol packages/contracts/test/RaffleOpenCohortIntegration.t.sol
git commit -m "feat(contracts): open RolloverEscrow cohort on season finalize

Raffle._executeFinalization now calls RolloverEscrow.openCohort(seasonId, 0)
when rolloverEscrow is wired. Eliminates the orchestration gap where every
cohort stayed in EscrowPhase.None and the rollover UI was permanently
hidden. Guarded by address(rolloverEscrow) != address(0) for deployments
without rollover support."
```

---

## Task 4 — Contract: deploy-script wiring for new `rolloverEscrow` slot + role grant

**Files:**
- Modify: `packages/contracts/script/deploy/DeployAll.s.sol:131-157`
- Modify: `packages/contracts/script/deploy/14_ConfigureRoles.s.sol:161-180`

- [ ] **Step 4.1: In `DeployAll.s.sol` 16b block, grant `DEFAULT_ADMIN_ROLE` on RolloverEscrow to Raffle and wire `raffle.setRolloverEscrow`**

Add inside the existing `vm.startBroadcast / vm.stopBroadcast` of 16b, after the `seasonFactory.setRolloverEscrow` block:

```solidity
Raffle raffle = Raffle(addrs.raffle);

try rolloverEscrow.grantRole(rolloverEscrow.DEFAULT_ADMIN_ROLE(), address(raffle)) {
    console2.log("Granted DEFAULT_ADMIN_ROLE on RolloverEscrow to Raffle");
} catch {
    console2.log("DEFAULT_ADMIN_ROLE on RolloverEscrow to Raffle already set");
}

try raffle.setRolloverEscrow(addrs.rolloverEscrow) {
    console2.log("Set RolloverEscrow on Raffle");
} catch {
    console2.log("RolloverEscrow on Raffle already set");
}
```

- [ ] **Step 4.2: Mirror the same two wires in `14_ConfigureRoles.s.sol`**

Inside the existing `if (addrs.rolloverEscrow != address(0))` block, after `setRolloverEscrow` on the distributor, add the same two `try/catch` wires from Step 4.1.

- [ ] **Step 4.3: Verify it builds**

```bash
cd packages/contracts && forge build 2>&1 | tail -3
```

- [ ] **Step 4.4: Commit**

```bash
git add packages/contracts/script/deploy/DeployAll.s.sol packages/contracts/script/deploy/14_ConfigureRoles.s.sol
git commit -m "chore(contracts): wire RolloverEscrow into Raffle in deploy scripts

Grant DEFAULT_ADMIN_ROLE on RolloverEscrow to Raffle so finalizeSeason
can openCohort. Wire raffle.setRolloverEscrow so the on-chain reference
is populated after a clean DeployAll run."
```

---

## Task 5 — Backend: chunked `pokeConsolationEligible` after `finalizeSeason`

**Files:**
- Modify: `packages/backend/src/services/seasonLifecycleService.js:213-257` and `:344-377`
- Create: `packages/backend/tests/services/seasonLifecycleService.poke.test.js`

- [ ] **Step 5.1: Write the failing backend test**

`packages/backend/tests/services/seasonLifecycleService.poke.test.js` — assert that:
- `finalizeSeason(seasonId, name)` produces exactly N+1 writeContract calls (1 finalize + N poke chunks)
- Chunks are at offsets 0, 500, 1000, ... matching `participants.length`
- Repeated invocation of `finalizeSeason` for the same seasonId is a no-op (idempotency)

Match whatever import shape `seasonLifecycleService.js` actually exports (singleton vs class). If singleton, monkey-patch `getWalletClient` and `publicClient` instead of constructing the service.

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd packages/backend && npm test -- seasonLifecycleService.poke 2>&1 | tail -15
```

- [ ] **Step 5.3: Generalize `submitWithRetry` to accept an optional `{address, abi}`**

Modify `submitWithRetry(functionName, args, label)` to `submitWithRetry(functionName, args, label, opts = {})`:

```js
async submitWithRetry(functionName, args, label, opts = {}) {
  const targetAddress = opts.address ?? this.raffleAddress;
  const targetAbi = opts.abi ?? RaffleAbi;
  // ... rest unchanged, but pass targetAddress + targetAbi into walletClient.writeContract
}
```

Keep all current behavior for callers that don't pass `opts`. (For this PR, poke targets the same Raffle address, so opts isn't strictly needed — but generalize anyway since openCohort or other escrow writes may need it later.)

- [ ] **Step 5.4: Add a chunked poke helper and call it after `finalizeSeason` succeeds**

In `seasonLifecycleService.js`, after the existing `finalizeSeason` confirmation block, add:

```js
await this.pokeConsolationEligibleChunked(seasonId);
```

Helper method:

```js
/**
 * Read participants.length for `seasonId` and walk pokeConsolationEligible
 * in CHUNK_SIZE-sized slices. Permissionless on-chain; idempotent (warm-SSTORE).
 */
async pokeConsolationEligibleChunked(seasonId) {
  const CHUNK_SIZE = 500n;
  const length = await publicClient.readContract({
    address: this.raffleAddress,
    abi: RaffleAbi,
    functionName: "getSeasonParticipantsLength",
    args: [seasonId],
  });

  this.logger.info(`📋 Poking ${length} participants for season ${seasonId} in chunks of ${CHUNK_SIZE}`);
  for (let offset = 0n; offset < length; offset += CHUNK_SIZE) {
    await this.submitWithRetry(
      "pokeConsolationEligible",
      [seasonId, offset, CHUNK_SIZE],
      `📋 Season ${seasonId} poke [${offset}..${offset + CHUNK_SIZE}]`
    );
  }
}
```

If `Raffle.sol` doesn't expose `getSeasonParticipantsLength`, this task expands to add it:

```solidity
function getSeasonParticipantsLength(uint256 seasonId) external view returns (uint256) {
    return seasonStates[seasonId].participants.length;
}
```

Check first with `grep -n "function getSeasonParticipants\|participants\.length" packages/contracts/src/core/Raffle.sol`. If a getter exists by a different name (e.g. `getParticipantCount`), use that name in the JS instead.

- [ ] **Step 5.5: Run test to verify it passes**

```bash
cd packages/backend && npm test -- seasonLifecycleService.poke 2>&1 | tail -10
```

- [ ] **Step 5.6: Run full backend suite**

```bash
cd packages/backend && npm test 2>&1 | tail -20
```

- [ ] **Step 5.7: Commit**

```bash
git add packages/backend/src/services/seasonLifecycleService.js packages/backend/tests/services/seasonLifecycleService.poke.test.js
git commit -m "feat(backend): poke consolation eligibility in chunks after finalize

Raffle.pokeConsolationEligible was permissionless and idempotent but
never called by any production code, so the consolation eligibility
map for every season was empty and every claim reverted NotAParticipant.
seasonLifecycleService.finalizeSeason now walks participants in 500-
chunks via the new pokeConsolationEligibleChunked helper after finalize
confirms."
```

---

## Task 6 — Frontend: extract `ConsolationClaimAction`

**Files:**
- Create: `packages/frontend/src/components/raffle/ConsolationClaimAction.jsx`
- Modify: `packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx`
- Create: `packages/frontend/tests/components/ConsolationClaimAction.test.jsx`

- [ ] **Step 6.1: Write the failing component test**

`ConsolationClaimAction.test.jsx` — two cases:
1. `useRollover` returns `hasClaimableRollover: false` → renders single plain claim button; clicking it calls `onClaimToWallet({ seasonId })`
2. `useRollover` returns `hasClaimableRollover: true` → renders green box + primary "Rollover" button + secondary "Claim to wallet instead" link; primary calls `claimToRollover.mutate`, secondary calls `onClaimToWallet`

Mock `useRollover` per case using `vi.mock("@/hooks/useRollover", ...)`.

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd packages/frontend && npm test -- ConsolationClaimAction 2>&1 | tail -10
```

- [ ] **Step 6.3: Create `ConsolationClaimAction.jsx`**

Take the entire body of `ConsolationClaimRow` from `ClaimCenterRaffles.jsx:11-72` and turn it into a standalone, reusable component with this props contract:

```js
ConsolationClaimAction.propTypes = {
  seasonId: PropTypes.any.isRequired,
  amount: PropTypes.any,         // bigint — claimable consolation amount
  isPending: PropTypes.bool.isRequired,
  onClaimToWallet: PropTypes.func.isRequired,  // ({seasonId}) => void
};
```

The component internally calls `useRollover(seasonId)` and renders the two variants. No props for the rollover mutation — it owns that.

- [ ] **Step 6.4: Replace `ConsolationClaimRow` body in `ClaimCenterRaffles.jsx`**

Replace lines 11-72 with a thin adapter that forwards to `ConsolationClaimAction`:

```jsx
import ConsolationClaimAction from "@/components/raffle/ConsolationClaimAction";

const ConsolationClaimRow = ({ row, isThisPending, claimRaffleConsolation }) => (
  <ConsolationClaimAction
    seasonId={row.seasonId}
    amount={row.amount}
    isPending={isThisPending}
    onClaimToWallet={(args) => claimRaffleConsolation.mutate(args)}
  />
);
```

Keep existing PropTypes on `ConsolationClaimRow`.

- [ ] **Step 6.5: Run tests — new + existing**

```bash
cd packages/frontend && npm test -- ConsolationClaimAction ClaimCenterRaffles 2>&1 | tail -15
```

- [ ] **Step 6.6: Commit**

```bash
git add packages/frontend/src/components/raffle/ConsolationClaimAction.jsx \
        packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx \
        packages/frontend/tests/components/ConsolationClaimAction.test.jsx
git commit -m "refactor(frontend): extract ConsolationClaimAction shared component

Lifts the green-box rollover/claim UI out of ConsolationClaimRow so it
can be reused on the Completed Raffle detail page. ClaimCenterRaffles
now uses it as a thin adapter."
```

---

## Task 7 — Frontend: render `ConsolationClaimAction` on Completed Raffle detail page

**Files:**
- Modify: `packages/frontend/src/components/raffle/CompletedRaffleResults.jsx`
- Modify: `packages/frontend/src/routes/RaffleDetails.jsx`
- Modify: `packages/frontend/tests/components/CompletedRaffleResults.test.jsx`

- [ ] **Step 7.1: Extend `CompletedRaffleResults` propTypes + accept `seasonId`, `viewerClaimableAmount`, `onClaimToWallet`**

Add three optional props. When `onClaimToWallet` is provided AND user is eligible-non-winner AND not yet claimed AND not VRF-pending, replace the static "youClaimable" badge with `<ConsolationClaimAction>`.

- [ ] **Step 7.2: Render `ConsolationClaimAction`** in the JSX where the `Badge variant="default"` for `youClaimable` currently sits (CompletedRaffleResults.jsx:116-121):

```jsx
{!isVrfPending &&
  consolationStatus.viewerEligible === true &&
  !consolationStatus.viewerClaimed &&
  onClaimToWallet && (
    <div className="mt-2">
      <ConsolationClaimAction
        seasonId={seasonId}
        amount={viewerClaimableAmount}
        isPending={false}
        onClaimToWallet={onClaimToWallet}
      />
    </div>
  )}
```

Keep the "youClaimed" badge as-is for the claimed case.

- [ ] **Step 7.3: Update `RaffleDetails.jsx` to thread the new props**

In `RaffleDetails.jsx` where `<CompletedRaffleResults />` is rendered (~line 477), add:

```jsx
import { useClaims } from "@/hooks/useClaims";

// inside the route component:
const { claimRaffleConsolation } = useClaims();

<CompletedRaffleResults
  // ... existing props
  seasonId={seasonId}
  viewerClaimableAmount={consolationStatus.perLoserShareWei}
  onClaimToWallet={({ seasonId: sid }) => claimRaffleConsolation.mutate({ seasonId: sid })}
/>
```

- [ ] **Step 7.4: Add the new test case to `CompletedRaffleResults.test.jsx`**

Eligible-non-winner case where `viewerEligible: true && !viewerClaimed && !isVrfPending`. Mock `useRollover` to return `hasClaimableRollover: false` (so the plain claim button is visible) and assert the button is rendered.

- [ ] **Step 7.5: Run all changed tests**

```bash
cd packages/frontend && npm test -- CompletedRaffleResults RaffleDetails 2>&1 | tail -15
```

- [ ] **Step 7.6: Commit**

```bash
git add packages/frontend/src/components/raffle/CompletedRaffleResults.jsx \
        packages/frontend/src/routes/RaffleDetails.jsx \
        packages/frontend/tests/components/CompletedRaffleResults.test.jsx
git commit -m "feat(frontend): render ConsolationClaimAction on Completed Raffle detail

Eligible non-winners can now claim (or roll over) their consolation prize
directly from the season detail page without navigating to /portfolio."
```

---

## Task 8 — Version bumps

- [ ] **Step 8.1: Bump**

```bash
npm version minor --workspace @sof/contracts --no-git-tag-version
npm version minor --workspace @sof/backend --no-git-tag-version
npm version minor --workspace @sof/frontend --no-git-tag-version
```

- [ ] **Step 8.2: Commit**

```bash
git add packages/*/package.json package-lock.json
git commit -m "chore: bump package versions for rollover + claim repair"
```

---

## Task 9 — Testnet redeploy + smoke

- [ ] **Step 9.1: Build contracts + export ABIs**

```bash
cd packages/contracts && npm run build
```

- [ ] **Step 9.2: Run `DeployAll` against base-sepolia**

```bash
cd packages/contracts
set -a; source env/.env.testnet; set +a
[[ "$PRIVATE_KEY" != 0x* ]] && export PRIVATE_KEY="0x$PRIVATE_KEY"
forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url https://base-sepolia.gateway.tenderly.co \
  --broadcast --slow --force \
  --verify --verifier etherscan \
  --verifier-url 'https://api.etherscan.io/v2/api?chainid=84532' \
  --etherscan-api-key "$ETHERSCAN_API_KEY"
cd ../.. && node scripts/extract-deployment-addresses.js --network testnet
```

- [ ] **Step 9.3: Verify on-chain wiring**

```bash
RAFFLE=$(jq -r '.contracts.Raffle' packages/contracts/deployments/testnet.json)
ESCROW=$(jq -r '.contracts.RolloverEscrow' packages/contracts/deployments/testnet.json)
PD=$(jq -r '.contracts.PrizeDistributor' packages/contracts/deployments/testnet.json)
PM=$(jq -r '.contracts.Paymaster' packages/contracts/deployments/testnet.json)
RPC=https://base-sepolia.gateway.tenderly.co
echo "raffle.rolloverEscrow:   $(cast call $RAFFLE 'rolloverEscrow()(address)' --rpc-url $RPC)"
DA=$(cast call $ESCROW 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url $RPC)
echo "raffle has admin@escrow: $(cast call $ESCROW 'hasRole(bytes32,address)(bool)' "$DA" "$RAFFLE" --rpc-url $RPC)"
echo "paymaster→distributor:   $(cast call $PM 'staticAllowlist(address)(bool)' "$PD" --rpc-url $RPC)"
```

All three should print non-zero / `true`.

- [ ] **Step 9.4: Push env vars** (only if addresses changed)

```bash
./scripts/deploy-env.sh --network testnet --dry-run
./scripts/deploy-env.sh --network testnet
```

- [ ] **Step 9.5: End-to-end smoke**

Start a fresh season, have 3-5 SMAs buy tickets, end the season, wait for VRF + auto-finalize. Verify backend log shows the poke step ran and that:
- `raffle.rolloverEscrow != 0`
- `getCohortState(newSeasonId).phase == Open` (no manual `cast` needed)
- `isConsolationEligible(newSeasonId, smaAddr)` is true for participants
- Losers can claim from both Portfolio and the Completed Raffle detail page

---

## Task 10 — Finalize PR

- [ ] **Step 10.1:** Re-run all tests + lint:

```bash
cd packages/contracts && forge test && cd ../..
npm test
npm run lint
```

- [ ] **Step 10.2:** Mark PR ready: `gh pr ready`
- [ ] **Step 10.3:** Merge via `github-pr-workflow` (squash + delete branch + sync local main)

---

## Open issues / follow-ups (separate PRs)

- Task #10: harden `fetchPaymasterSession` error parsing (P1 transient viem error reproducer)
- Task #11: claim toast → show tx hash + explorer link
- Task #12: Rollover position display in Portfolio
- Task #13: SOF balance read is slow — audit Supabase cache wiring

These are out of scope for this PR; they have separate TaskCreate entries.
