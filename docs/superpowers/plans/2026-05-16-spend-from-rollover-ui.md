# Spend-from-Rollover UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire BuySellWidget to actually use the user's rollover deposit when funding a ticket purchase in the next season, with a mixed-batch ERC-7821 userOp for shortfall top-up from wallet.

**Architecture:** A new `useEligibleRolloverCohort(currentSeasonId)` hook reads cohortId = `currentSeasonId − 1n` and exposes `isEligible` only when (`phase === active && nextSeasonId === currentSeasonId && available > 0n`). `useBuySellTransactions.executeBuy` gets a new mixed-batch branch that bundles `spendFromRollover + approve + buyTokens` into one userOp when the requested buy exceeds the rollover balance. No contract or backend changes.

**Tech Stack:** React 18, wagmi v2, viem v2, @tanstack/react-query v5, vitest, react-i18next, ERC-7821 / ERC-4337 via `useSmartTransactions`.

**Spec:** `docs/superpowers/specs/2026-05-16-spend-from-rollover-ui-design.md`

---

## Files touched

**Create:**
- `packages/frontend/src/hooks/useEligibleRolloverCohort.js`
- `packages/frontend/src/hooks/buysell/computeBuySplit.js` (pure helper — testable in isolation)
- `packages/frontend/tests/hooks/useEligibleRolloverCohort.test.js`
- `packages/frontend/tests/hooks/computeBuySplit.test.js`

**Modify:**
- `packages/frontend/src/components/curve/BuySellWidget.jsx` — swap to `useEligibleRolloverCohort`, compute split via helper, pass new props to banner + handlers.
- `packages/frontend/src/components/curve/RolloverBanner.jsx` — accept `estBuyWithFees` + `walletTopupSof` + `walletTopupTickets`, render mixed-batch line.
- `packages/frontend/src/hooks/buysell/useBuySellTransactions.js` — add mixed-batch branch in `executeBuy`.
- `packages/frontend/src/hooks/buysell/useBalanceValidation.js` — accept optional `rolloverEffectiveAmount` (default `0n`).
- `packages/frontend/src/hooks/buysell/useTransactionHandlers.js` — thread `walletTopupTickets`/`walletTopupMaxSof` through to `executeBuy`.
- `packages/frontend/tests/components/RolloverBanner.test.jsx` — add mixed-batch line case (create file if absent).
- `packages/frontend/tests/components/BuySellWidget.test.jsx` — three new scenarios (banner shows, mixed-batch submit, rollover-disabled submit). Create if absent — check for an existing test file first.
- `packages/frontend/tests/hooks/useBuySellTransactions.test.js` — add mixed-batch case (create if absent).
- `packages/frontend/tests/hooks/useBalanceValidation.test.js` — extend with rollover-aware case (create if absent).
- `packages/frontend/package.json` — minor version bump (0.33.0 → 0.34.0).

---

## Task 1 — Branch + plan commit

**Files:**
- Create: `docs/superpowers/plans/2026-05-16-spend-from-rollover-ui.md` (this file — already on `feat/spend-from-rollover-ui`)

- [x] **Step 1.1:** Branch `feat/spend-from-rollover-ui` already created from `origin/main` (commit `4d13fdd` — spec doc lives there).
- [ ] **Step 1.2:** Commit this plan doc:

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add docs/superpowers/plans/2026-05-16-spend-from-rollover-ui.md && git commit -m "$(cat <<'EOF'
docs(plan): spend-from-rollover UI implementation plan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.3:** Push and open a draft PR:

```bash
git push -u origin feat/spend-from-rollover-ui
gh pr create --draft --title "feat: wire spendFromRollover into BuySellWidget" --body "$(cat <<'EOF'
## Summary
Closes task #22 from PR #83 followup queue. BuySellWidget reads the wrong cohort (currentSeasonId instead of currentSeasonId-1) so users with eligible rollover never see the spend-from-rollover path. Fix: new useEligibleRolloverCohort hook + mixed-batch ERC-7821 branch in executeBuy.

Spec: docs/superpowers/specs/2026-05-16-spend-from-rollover-ui-design.md
Plan: docs/superpowers/plans/2026-05-16-spend-from-rollover-ui.md

## Test plan
- [ ] `npm test -w @sof/frontend` passes (target 402/402 from 396/396 baseline)
- [ ] `npm run lint -w @sof/frontend` clean
- [ ] Manual smoke on testnet: P1 with rollover deposit in cohort 1 buys S2 tickets, sees banner, mixed-batch path actually executes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 2 — `useEligibleRolloverCohort` hook (TDD)

**Files:**
- Create: `packages/frontend/src/hooks/useEligibleRolloverCohort.js`
- Create: `packages/frontend/tests/hooks/useEligibleRolloverCohort.test.js`

- [ ] **Step 2.1: Write the failing test**

`packages/frontend/tests/hooks/useEligibleRolloverCohort.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockReadContract = vi.fn();
const mockSma = vi.fn();

vi.mock("wagmi", () => ({
  usePublicClient: () => ({ readContract: mockReadContract }),
}));
vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: mockSma() }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ ROLLOVER_ESCROW: "0xescrow" }),
}));
vi.mock("@/services/onchainRolloverEscrow", () => ({
  readCohortState: vi.fn(),
  readAvailableBalance: vi.fn(),
}));

import { readCohortState, readAvailableBalance } from "@/services/onchainRolloverEscrow";
import { useEligibleRolloverCohort } from "@/hooks/useEligibleRolloverCohort";

function wrapper({ children }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useEligibleRolloverCohort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSma.mockReturnValue("0xsma");
    readCohortState.mockResolvedValue({
      phase: "active",
      nextSeasonId: 2n,
      bonusBps: 600,
    });
    readAvailableBalance.mockResolvedValue(455n * 10n ** 18n);
  });

  it("returns isEligible=false synchronously when currentSeasonId <= 1n", async () => {
    const { result } = renderHook(() => useEligibleRolloverCohort(1n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
    expect(readCohortState).not.toHaveBeenCalled();
    expect(readAvailableBalance).not.toHaveBeenCalled();
  });

  it("returns isEligible=true when phase=active, nextSeasonId matches, available > 0", async () => {
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(true);
    expect(result.current.cohortSeasonId).toBe(1n);
    expect(result.current.available).toBe(455n * 10n ** 18n);
    expect(result.current.bonusBps).toBe(600);
    expect(result.current.bonusAmount(100n * 10n ** 18n)).toBe(6n * 10n ** 18n);
  });

  it("returns isEligible=false when cohort phase is open (not yet active)", async () => {
    readCohortState.mockResolvedValue({ phase: "open", nextSeasonId: 2n, bonusBps: 600 });
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
  });

  it("returns isEligible=false when nextSeasonId on cohort doesn't match", async () => {
    readCohortState.mockResolvedValue({ phase: "active", nextSeasonId: 99n, bonusBps: 600 });
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
  });

  it("returns isEligible=false when available is 0", async () => {
    readAvailableBalance.mockResolvedValue(0n);
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
  });

  it("returns isEligible=false without any reads when sma is missing", async () => {
    mockSma.mockReturnValue(null);
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
    expect(readCohortState).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- useEligibleRolloverCohort 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the hook**

Create `packages/frontend/src/hooks/useEligibleRolloverCohort.js`:

```js
import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import {
  readCohortState,
  readAvailableBalance,
} from "@/services/onchainRolloverEscrow";

/**
 * For a user buying tickets in `currentSeasonId`, finds the rollover cohort
 * (if any) that can fund the spend. Rollover qualifies N→N+1 only, so we look
 * at exactly one cohort: `currentSeasonId - 1n`.
 *
 * Eligibility:
 *   cohort.phase === "active"
 *   && cohort.nextSeasonId === currentSeasonId
 *   && available > 0n
 *
 * @param {bigint} currentSeasonId - the season the user is buying tickets in
 * @returns {{
 *   cohortSeasonId: bigint | null,
 *   available: bigint,
 *   bonusBps: number,
 *   bonusAmount: (sofAmount: bigint) => bigint,
 *   isEligible: boolean,
 *   isLoading: boolean,
 *   error: Error | null,
 * }}
 */
export function useEligibleRolloverCohort(currentSeasonId) {
  const { sma } = useRaffleAccount();
  const publicClient = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  const candidate = currentSeasonId > 1n ? currentSeasonId - 1n : null;

  const enabled = Boolean(
    sma && publicClient && candidate && contracts.ROLLOVER_ESCROW
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["rollover-eligible", sma, String(currentSeasonId), netKey],
    queryFn: async () => {
      const [cohort, available] = await Promise.all([
        readCohortState({ publicClient, seasonId: candidate, networkKey: netKey }),
        readAvailableBalance({
          publicClient,
          seasonId: candidate,
          address: sma,
          networkKey: netKey,
        }),
      ]);
      return { cohort, available };
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const cohort = data?.cohort;
  const available = data?.available ?? 0n;
  const bonusBps = cohort?.bonusBps ?? 0;

  const bonusAmount = useCallback(
    (sofAmount) => (sofAmount * BigInt(bonusBps)) / 10000n,
    [bonusBps]
  );

  const isEligible = Boolean(
    enabled &&
      cohort?.phase === "active" &&
      cohort?.nextSeasonId === currentSeasonId &&
      available > 0n
  );

  return {
    cohortSeasonId: isEligible ? candidate : null,
    available,
    bonusBps,
    bonusAmount,
    isEligible,
    isLoading,
    error: error ?? null,
  };
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- useEligibleRolloverCohort 2>&1 | tail -10
```

Expected: 6/6 pass.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/hooks/useEligibleRolloverCohort.js packages/frontend/tests/hooks/useEligibleRolloverCohort.test.js && git commit -m "$(cat <<'EOF'
feat(frontend): useEligibleRolloverCohort hook for buy-time rollover lookup

Reads cohortId = currentSeasonId − 1n; reports isEligible only when
phase=active, nextSeasonId matches, and available > 0. Decoupled from
useRollover (which answers the claim-time "your position in cohort N"
question) so the buy widget and claim center don't muddle their
semantics.

Closes Task 2 of spend-from-rollover plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Pure `computeBuySplit` helper (TDD)

Pure function that splits a requested ticket purchase across rollover + wallet. Isolated for unit-test ease.

**Files:**
- Create: `packages/frontend/src/hooks/buysell/computeBuySplit.js`
- Create: `packages/frontend/tests/hooks/computeBuySplit.test.js`

- [ ] **Step 3.1: Write the failing test**

`packages/frontend/tests/hooks/computeBuySplit.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeBuySplit } from "@/hooks/buysell/computeBuySplit";

describe("computeBuySplit", () => {
  it("returns all-wallet split when rolloverAmount = 0", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 0n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1000n);
    expect(r.walletTopupSofBase).toBe(1000n * 10n ** 18n);
  });

  it("returns all-rollover split when rolloverAmount >= estBuyWithFees", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 1000n * 10n ** 18n,
    });
    expect(r.rolloverTickets).toBe(1000n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("splits proportionally when 0 < rolloverAmount < estBuyWithFees", () => {
    // tokenAmount=1000, estBuyWithFees=1000 SOF, rollover=455 SOF → 455 tickets
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 455n * 10n ** 18n,
    });
    expect(r.rolloverTickets).toBe(455n);
    expect(r.walletTopupTickets).toBe(545n);
    expect(r.walletTopupSofBase).toBe(545n * 10n ** 18n);
  });

  it("rounds rolloverTickets DOWN so user never under-pays the curve", () => {
    // rollover=333.333 SOF on 1000 SOF total → 333 tickets (not 334)
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 3333n * 10n ** 17n, // 333.3 SOF
    });
    expect(r.rolloverTickets).toBe(333n);
    expect(r.walletTopupTickets).toBe(667n);
  });

  it("handles tokenAmount=0 without dividing by zero", () => {
    const r = computeBuySplit({
      tokenAmount: 0n,
      estBuyWithFees: 0n,
      rolloverAmount: 100n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("handles estBuyWithFees=0 (curve not ready) without dividing by zero", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 0n,
      rolloverAmount: 100n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1000n);
    expect(r.walletTopupSofBase).toBe(0n);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- computeBuySplit 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the helper**

`packages/frontend/src/hooks/buysell/computeBuySplit.js`:

```js
/**
 * Split a requested ticket purchase across rollover SOF + wallet SOF.
 *
 *   rolloverTickets   = floor(tokenAmount × rolloverAmount / estBuyWithFees)
 *   walletTopupTickets= tokenAmount − rolloverTickets
 *   walletTopupSofBase= estBuyWithFees − rolloverAmount      (positive only)
 *
 * Rounds rolloverTickets DOWN so the curve is never under-paid; the wallet
 * top-up picks up the rounding slack.
 *
 * `walletTopupSofBase` is the pre-slippage SOF the wallet needs to cover.
 * The caller applies its slippage policy on top of this before passing
 * `walletTopupMaxSof` to executeBuy.
 *
 * @param {object} p
 * @param {bigint} p.tokenAmount - total tickets requested (base units)
 * @param {bigint} p.estBuyWithFees - SOF cost (wei) the curve will charge for tokenAmount
 * @param {bigint} p.rolloverAmount - SOF (wei) the user wants to draw from rollover
 * @returns {{rolloverTickets: bigint, walletTopupTickets: bigint, walletTopupSofBase: bigint}}
 */
export function computeBuySplit({ tokenAmount, estBuyWithFees, rolloverAmount }) {
  if (tokenAmount <= 0n || estBuyWithFees <= 0n || rolloverAmount <= 0n) {
    return {
      rolloverTickets: 0n,
      walletTopupTickets: tokenAmount,
      walletTopupSofBase: estBuyWithFees,
    };
  }

  if (rolloverAmount >= estBuyWithFees) {
    return {
      rolloverTickets: tokenAmount,
      walletTopupTickets: 0n,
      walletTopupSofBase: 0n,
    };
  }

  const rolloverTickets = (tokenAmount * rolloverAmount) / estBuyWithFees;
  const walletTopupTickets = tokenAmount - rolloverTickets;
  const walletTopupSofBase = estBuyWithFees - rolloverAmount;

  return { rolloverTickets, walletTopupTickets, walletTopupSofBase };
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- computeBuySplit 2>&1 | tail -10
```

Expected: 6/6 pass.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/hooks/buysell/computeBuySplit.js packages/frontend/tests/hooks/computeBuySplit.test.js && git commit -m "$(cat <<'EOF'
feat(frontend): computeBuySplit pure helper for mixed-batch buy math

Splits a requested ticket purchase across rollover + wallet portions.
Rounds rolloverTickets DOWN so the curve is never under-paid;
walletTopup picks up the rounding slack.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `useBuySellTransactions.executeBuy` mixed-batch branch (TDD)

**Files:**
- Modify: `packages/frontend/src/hooks/buysell/useBuySellTransactions.js:89-146`
- Create: `packages/frontend/tests/hooks/useBuySellTransactions.test.js`

- [ ] **Step 4.1: Write the failing test**

`packages/frontend/tests/hooks/useBuySellTransactions.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

const mockExecuteBatch = vi.fn();
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: mockExecuteBatch }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF: "0xsof" }),
}));
vi.mock("@/services/onchainRolloverEscrow", () => ({
  buildSpendFromRolloverCall: ({ seasonId, sofAmount, ticketAmount, maxTotalSof }) => ({
    to: "0xescrow",
    data: `spend(${seasonId},${sofAmount},${ticketAmount},${maxTotalSof})`,
  }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import { useBuySellTransactions } from "@/hooks/buysell/useBuySellTransactions";

const ONE_SOF = 10n ** 18n;

describe("useBuySellTransactions.executeBuy mixed-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteBatch.mockResolvedValue("0xtxhash");
  });

  function setup() {
    const { result } = renderHook(() =>
      useBuySellTransactions("0xcurve", null, vi.fn(), vi.fn())
    );
    return result;
  }

  it("submits wallet-only batch when rolloverAmount = 0", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: null,
        rolloverAmount: 0n,
        walletTopupTickets: 1000n,
        walletTopupMaxSof: 1010n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe("0xsof");
    expect(calls[1].to).toBe("0xcurve");
  });

  it("submits rollover-only batch when rolloverAmount covers the full buy", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 1000n * ONE_SOF,
        walletTopupTickets: 0n,
        walletTopupMaxSof: 0n,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("0xescrow");
  });

  it("submits 3-call mixed batch when rolloverAmount < estBuyWithFees", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 455n * ONE_SOF,
        walletTopupTickets: 545n,
        walletTopupMaxSof: 551n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(3);
    expect(calls[0].to).toBe("0xescrow");
    expect(calls[0].data).toContain("455");      // sofAmount
    expect(calls[1].to).toBe("0xsof");           // approve
    expect(calls[2].to).toBe("0xcurve");         // buyTokens for top-up
  });

  it("computes rolloverTickets in the mixed branch by tokenAmount − walletTopupTickets", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 455n * ONE_SOF,
        walletTopupTickets: 545n,
        walletTopupMaxSof: 551n * ONE_SOF,
      });
    });
    const spendCall = mockExecuteBatch.mock.calls[0][0][0];
    // ticketAmount in spendFromRollover args is 1000 - 545 = 455
    expect(spendCall.data).toContain(",455,");
  });
});
```

- [ ] **Step 4.2: Run test to verify failures**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- useBuySellTransactions 2>&1 | tail -15
```

Expected: mixed-batch + rolloverTickets cases FAIL; wallet-only and rollover-only PASS (existing behavior).

- [ ] **Step 4.3: Add mixed-batch branch in `executeBuy`**

In `packages/frontend/src/hooks/buysell/useBuySellTransactions.js`, replace lines 89-146 (`executeBuy` callback) with:

```js
  const executeBuy = useCallback(
    async ({
      tokenAmount,
      maxSofAmount,
      slippagePct,
      onComplete,
      rolloverSeasonId,
      rolloverAmount,
      walletTopupTickets = 0n,
      walletTopupMaxSof = 0n,
    }) => {
      setIsPending(true);
      try {
        const cap = applyMaxSlippage(maxSofAmount, slippagePct);
        const hasRollover = rolloverSeasonId && rolloverAmount > 0n;
        const hasWalletTopup = hasRollover && walletTopupTickets > 0n;

        let calls;
        if (hasRollover && hasWalletTopup) {
          // Mixed batch: rollover funds part of the buy, wallet funds the rest.
          // ticketAmount on spendFromRollover is the rollover-funded portion only.
          const { buildSpendFromRolloverCall } = await import("@/services/onchainRolloverEscrow");
          const rolloverTickets = tokenAmount - walletTopupTickets;
          calls = [
            buildSpendFromRolloverCall({
              seasonId: rolloverSeasonId,
              sofAmount: rolloverAmount,
              ticketAmount: rolloverTickets,
              maxTotalSof: rolloverAmount + (rolloverAmount * 1000n) / 10000n, // base + 10% headroom for bonus
            }),
            {
              to: contracts.SOF,
              data: encodeFunctionData({
                abi: ERC20Abi,
                functionName: "approve",
                args: [bondingCurveAddress, walletTopupMaxSof],
              }),
            },
            {
              to: bondingCurveAddress,
              data: encodeFunctionData({
                abi: SOFBondingCurveAbi,
                functionName: "buyTokens",
                args: [walletTopupTickets, walletTopupMaxSof],
              }),
            },
          ];
        } else if (hasRollover) {
          // Rollover-only: escrow handles approve + buyTokensFor internally.
          const { buildSpendFromRolloverCall } = await import("@/services/onchainRolloverEscrow");
          calls = [
            buildSpendFromRolloverCall({
              seasonId: rolloverSeasonId,
              sofAmount: rolloverAmount,
              ticketAmount: tokenAmount,
              maxTotalSof: cap,
            }),
          ];
        } else {
          // Wallet-only: SMA approves curve and calls buyTokens.
          calls = [
            {
              to: contracts.SOF,
              data: encodeFunctionData({
                abi: ERC20Abi,
                functionName: "approve",
                args: [bondingCurveAddress, cap],
              }),
            },
            {
              to: bondingCurveAddress,
              data: encodeFunctionData({
                abi: SOFBondingCurveAbi,
                functionName: "buyTokens",
                args: [tokenAmount, cap],
              }),
            },
          ];
        }

        const hash = await executeBatch(calls, { sofAmount: cap });
        return await finishWithReceipt(hash, "transactions:bought", onComplete);
      } catch (err) {
        if (err?.code === 4001 || err?.name === "UserRejectedRequestError") {
          onNotify?.({ type: "error", message: t("transactions:userRejected", { defaultValue: "Transaction rejected" }), hash: "" });
          return { success: false, error: "user_rejected" };
        }
        // eslint-disable-next-line no-console
        console.error("Buy transaction error:", err);
        const message = getReadableContractError(err, t);
        onNotify?.({ type: "error", message, hash: "" });
        return { success: false, error: message };
      } finally {
        setIsPending(false);
      }
    },
    [bondingCurveAddress, contracts.SOF, executeBatch, finishWithReceipt, onNotify, t]
  );
```

Note on `maxTotalSof` for the spendFromRollover call: contract pulls `bonusAmount = sofAmount × bonusBps / 10000` from treasury then calls `curve.buyTokensFor(msg.sender, ticketAmount, maxTotalSof)`. Our cap of `rolloverAmount + 10% headroom` covers the typical 6% bonus comfortably while staying tight enough to surface curve-price drift as a revert rather than overpaying.

- [ ] **Step 4.4: Run test to verify pass**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- useBuySellTransactions 2>&1 | tail -10
```

Expected: 4/4 pass.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/hooks/buysell/useBuySellTransactions.js packages/frontend/tests/hooks/useBuySellTransactions.test.js && git commit -m "$(cat <<'EOF'
feat(frontend): mixed-batch branch in useBuySellTransactions.executeBuy

Adds a third branch: when rollover funds part of the buy and the user
needs wallet SOF to cover the rest, build a 3-call ERC-7821 batch
(spendFromRollover + approve + buyTokens) instead of either
wallet-only or rollover-only. ERC-7821 atomicity means if either
sub-call reverts, the whole batch reverts — no partial state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — `useBalanceValidation` rollover-aware (TDD)

**Files:**
- Modify: `packages/frontend/src/hooks/buysell/useBalanceValidation.js`
- Create: `packages/frontend/tests/hooks/useBalanceValidation.test.js`

- [ ] **Step 5.1: Write the failing test**

`packages/frontend/tests/hooks/useBalanceValidation.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBalanceValidation } from "@/hooks/buysell/useBalanceValidation";

const ONE_SOF = 10n ** 18n;

describe("useBalanceValidation", () => {
  it("returns hasInsufficientBalance=true when wallet < required and no rollover", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 100n * ONE_SOF, false)
    );
    expect(result.current.hasInsufficientBalance).toBe(true);
  });

  it("returns hasInsufficientBalance=false when wallet alone covers required", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("200", 18, 100n * ONE_SOF, false)
    );
    expect(result.current.hasInsufficientBalance).toBe(false);
  });

  it("counts rolloverEffectiveAmount toward the available balance", () => {
    // wallet=50 SOF, required=100 SOF, rollover effective (base+bonus)=60 SOF
    // 50 + 60 = 110 ≥ 100 → not insufficient
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 100n * ONE_SOF, false, 60n * ONE_SOF)
    );
    expect(result.current.hasInsufficientBalance).toBe(false);
  });

  it("still flags insufficient when wallet+rollover combined < required", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 200n * ONE_SOF, false, 60n * ONE_SOF)
    );
    expect(result.current.hasInsufficientBalance).toBe(true);
  });

  it("treats omitted rolloverEffectiveAmount as 0 (back-compat)", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 100n * ONE_SOF, false)
    );
    expect(result.current.hasInsufficientBalance).toBe(true);
  });
});
```

- [ ] **Step 5.2: Run test to verify failures**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- useBalanceValidation 2>&1 | tail -10
```

Expected: rollover-aware case FAILS; existing wallet-only cases PASS.

- [ ] **Step 5.3: Add the rollover parameter**

Replace `packages/frontend/src/hooks/buysell/useBalanceValidation.js` with:

```js
/**
 * useBalanceValidation Hook
 * Validates SOF balance against required amounts for buy operations.
 * When a rollover deposit is available + enabled, callers pass
 * `rolloverEffectiveAmount` (base + bonus) and the effective available
 * balance becomes wallet + rollover for purposes of the insufficient check.
 */

import { useMemo } from "react";
import { parseUnits } from "viem";

/**
 * @param {string}  sofBalance              current wallet SOF balance as string
 * @param {number}  sofDecimals             SOF token decimals
 * @param {bigint}  requiredAmount          required amount in wei
 * @param {boolean} isBalanceLoading        whether balance is still loading
 * @param {bigint}  [rolloverEffectiveAmount=0n] rollover SOF (base + bonus)
 * @returns {{hasInsufficientBalance: boolean, hasZeroBalance: boolean, sofBalanceBigInt: bigint}}
 */
export function useBalanceValidation(
  sofBalance,
  sofDecimals,
  requiredAmount,
  isBalanceLoading,
  rolloverEffectiveAmount = 0n
) {
  const sofBalanceBigInt = useMemo(() => {
    try {
      return parseUnits(sofBalance ?? "0", sofDecimals);
    } catch {
      return 0n;
    }
  }, [sofBalance, sofDecimals]);

  const requiresBalance = requiredAmount > 0n;
  const effectiveAvailable = sofBalanceBigInt + rolloverEffectiveAmount;

  const hasInsufficientBalance =
    !isBalanceLoading && requiresBalance && effectiveAvailable < requiredAmount;

  const hasZeroBalance =
    !isBalanceLoading && requiresBalance && effectiveAvailable === 0n;

  return {
    sofBalanceBigInt,
    hasInsufficientBalance,
    hasZeroBalance,
  };
}
```

- [ ] **Step 5.4: Run test to verify pass**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- useBalanceValidation 2>&1 | tail -10
```

Expected: 5/5 pass.

- [ ] **Step 5.5: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/hooks/buysell/useBalanceValidation.js packages/frontend/tests/hooks/useBalanceValidation.test.js && git commit -m "$(cat <<'EOF'
feat(frontend): rollover-aware balance validation

Adds optional rolloverEffectiveAmount param (default 0n for back-compat).
hasInsufficientBalance now flags only when wallet + rollover combined
falls short of the required amount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — `useTransactionHandlers` thread mixed-batch params

**Files:**
- Modify: `packages/frontend/src/hooks/buysell/useTransactionHandlers.js`

- [ ] **Step 6.1: Read current handler signature**

```bash
sed -n '1,40p' /Users/psd/Projects/SOf/sof-beta/packages/frontend/src/hooks/buysell/useTransactionHandlers.js
grep -n "executeBuy\|handleBuy" /Users/psd/Projects/SOf/sof-beta/packages/frontend/src/hooks/buysell/useTransactionHandlers.js | head -20
```

- [ ] **Step 6.2: Add `walletTopupTickets` + `walletTopupMaxSof` pass-through**

Inside `useTransactionHandlers`, find the destructuring of params and the call to `executeBuy`. Add the two new fields to both, alongside existing `rolloverAmount`/`rolloverSeasonId`. Concretely:

In the function signature destructuring (top of `useTransactionHandlers`), add:
```js
rolloverEnabled,
rolloverAmount,
rolloverSeasonId,
walletTopupTickets,    // NEW
walletTopupMaxSof,     // NEW
```

In the `handleBuy` body where `executeBuy({...})` is called, pass the new fields through:
```js
await executeBuy({
  tokenAmount,
  maxSofAmount,
  slippagePct,
  onComplete,
  rolloverSeasonId: rolloverEnabled ? rolloverSeasonId : null,
  rolloverAmount: rolloverEnabled ? rolloverAmount : 0n,
  walletTopupTickets: rolloverEnabled ? walletTopupTickets : 0n,
  walletTopupMaxSof: rolloverEnabled ? walletTopupMaxSof : 0n,
});
```

- [ ] **Step 6.3: Lint check**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm run lint 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6.4: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/hooks/buysell/useTransactionHandlers.js && git commit -m "$(cat <<'EOF'
feat(frontend): thread walletTopupTickets/walletTopupMaxSof through handlers

useTransactionHandlers now forwards the mixed-batch params from the
widget into executeBuy. No behavior change for callers that don't pass
them; back-compat preserved via default 0n.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — `BuySellWidget` swap to eligible-cohort hook + compute split

**Files:**
- Modify: `packages/frontend/src/components/curve/BuySellWidget.jsx`

- [ ] **Step 7.1: Replace `useRollover` import + invocation with `useEligibleRolloverCohort`**

Top of file, replace:
```js
import { useRollover } from "@/hooks/useRollover";
```
with:
```js
import { useEligibleRolloverCohort } from "@/hooks/useEligibleRolloverCohort";
import { computeBuySplit } from "@/hooks/buysell/computeBuySplit";
import { applyMaxSlippage } from "@/lib/slippage"; // or wherever the existing helper lives — check imports of useBuySellTransactions for the canonical import path
```

Replace the existing useRollover block (around lines 89-95):
```js
  // Rollover hook
  const {
    rolloverBalance,
    bonusBps,
    bonusAmount,
    isRolloverAvailable,
  } = useRollover(seasonId);
```
with:
```js
  // Rollover-spend lookup: find the cohort funding a buy in this season.
  const {
    cohortSeasonId,
    available: rolloverBalance,
    bonusBps,
    bonusAmount,
    isEligible: isRolloverAvailable,
  } = useEligibleRolloverCohort(BigInt(seasonId));
```

- [ ] **Step 7.2: Compute the split + wallet-topup amounts**

Replace the existing `rolloverAmount` definition with the split-driven version. Around line 120-125, replace:
```js
  const rolloverAmount = rolloverAmountOverride ?? (
    isRolloverAvailable && rolloverEnabled
      ? (rolloverBalance < estBuyWithFees ? rolloverBalance : estBuyWithFees)
      : 0n
  );
```
with:
```js
  const rolloverAmount = rolloverAmountOverride ?? (
    isRolloverAvailable && rolloverEnabled
      ? (rolloverBalance < estBuyWithFees ? rolloverBalance : estBuyWithFees)
      : 0n
  );

  // Split the requested ticket count across rollover + wallet portions.
  const { walletTopupTickets, walletTopupSofBase } = computeBuySplit({
    tokenAmount: BigInt(buyAmount || "0"),
    estBuyWithFees,
    rolloverAmount,
  });

  // Apply slippage to the wallet-topup base amount for the maxSof cap.
  const walletTopupMaxSof = applyMaxSlippage(walletTopupSofBase, slippagePct);

  // Effective rollover SOF available to the balance check (base + bonus).
  const rolloverEffectiveAmount = rolloverAmount + bonusAmount(rolloverAmount);
```

- [ ] **Step 7.3: Pass rollover-aware effective amount to balance validation**

Update the existing `useBalanceValidation(...)` call (around line 113):
```js
  const { hasInsufficientBalance, hasZeroBalance } = useBalanceValidation(
    sofBalance,
    sofDecimals,
    estBuyWithFees,
    isBalanceLoading,
    isRolloverAvailable && rolloverEnabled ? rolloverEffectiveAmount : 0n,
  );
```

- [ ] **Step 7.4: Pass new fields to `useTransactionHandlers`**

Update the existing `useTransactionHandlers({...})` call (around line 134), adding two fields and swapping `rolloverSeasonId` to point at the eligible cohort:
```js
    rolloverEnabled: isRolloverAvailable && rolloverEnabled,
    rolloverAmount,
    rolloverSeasonId: cohortSeasonId,           // CHANGED: was `seasonId`
    walletTopupTickets,                          // NEW
    walletTopupMaxSof,                           // NEW
```

- [ ] **Step 7.5: Pass new props to `RolloverBanner`**

In the `<RolloverBanner>` JSX (around line 254), add three new props alongside the existing ones:
```jsx
{isRolloverAvailable && (
  <RolloverBanner
    rolloverBalance={rolloverBalance}
    bonusBps={bonusBps}
    bonusAmount={bonusAmount}
    sourceSeasonId={cohortSeasonId}                // CHANGED: was `seasonId`
    enabled={rolloverEnabled}
    onEnabledChange={setRolloverEnabled}
    rolloverAmount={rolloverAmount}
    onRolloverAmountChange={setRolloverAmountOverride}
    estBuyWithFees={estBuyWithFees}                 // NEW
    walletTopupSof={walletTopupSofBase}              // NEW (pre-slippage; banner displays as-is)
    walletTopupTickets={walletTopupTickets}          // NEW
  />
)}
```

- [ ] **Step 7.6: Lint + run frontend tests**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm run lint 2>&1 | tail -3 && npm test 2>&1 | grep -E "Test Files|Tests" | tail -5
```

Expected: lint clean, all tests pass (any banner tests will fail in Task 8 — that's fine here as long as count matches expected at that step).

- [ ] **Step 7.7: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/components/curve/BuySellWidget.jsx && git commit -m "$(cat <<'EOF'
feat(frontend): BuySellWidget reads eligible rollover cohort + mixed-batch

Swaps useRollover(seasonId) → useEligibleRolloverCohort(seasonId), which
looks at cohortId = seasonId − 1 (the cohort whose nextSeasonId points
at this season). Adds computeBuySplit for the rollover/wallet ticket
split and threads walletTopupTickets + walletTopupMaxSof through to
the buy handler so the mixed batch in useBuySellTransactions fires
when requested buy > available rollover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — `RolloverBanner` mixed-batch line (TDD)

**Files:**
- Modify: `packages/frontend/src/components/curve/RolloverBanner.jsx`
- Create or extend: `packages/frontend/tests/components/RolloverBanner.test.jsx`

- [ ] **Step 8.1: Write the failing test**

Check if the file exists. If yes, extend. If not, create:

```bash
ls /Users/psd/Projects/SOf/sof-beta/packages/frontend/tests/components/RolloverBanner.test.jsx 2>&1 | head -1
```

Content (replace fully if creating):

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RolloverBanner from "@/components/curve/RolloverBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k, opts) => (opts?.amount ? `${k} amount=${opts.amount}` : opts?.percent ? `${k} percent=${opts.percent}` : k) }),
}));

const ONE_SOF = 10n ** 18n;
const baseProps = {
  rolloverBalance: 455n * ONE_SOF,
  bonusBps: 600,
  bonusAmount: (sof) => (sof * 600n) / 10000n,
  sourceSeasonId: 1n,
  enabled: true,
  onEnabledChange: vi.fn(),
  rolloverAmount: 455n * ONE_SOF,
  onRolloverAmountChange: vi.fn(),
  estBuyWithFees: 455n * ONE_SOF,
  walletTopupSof: 0n,
  walletTopupTickets: 0n,
};

describe("RolloverBanner", () => {
  it("renders only the rollover line when walletTopup is zero", () => {
    render(<RolloverBanner {...baseProps} />);
    expect(screen.queryByText(/walletTopup/)).toBeNull();
  });

  it("renders the wallet-topup line when walletTopupTickets > 0", () => {
    render(<RolloverBanner {...baseProps} walletTopupSof={518n * ONE_SOF} walletTopupTickets={518n} />);
    // i18n is mocked to echo the key + amount; assert key is referenced
    expect(screen.getByText(/raffle:walletTopupLine/)).toBeInTheDocument();
  });

  it("fires onEnabledChange when the switch is toggled", () => {
    const onEnabledChange = vi.fn();
    const { container } = render(<RolloverBanner {...baseProps} onEnabledChange={onEnabledChange} />);
    const switchEl = container.querySelector("[role='switch'], button[type='button']");
    if (switchEl) fireEvent.click(switchEl);
    expect(onEnabledChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8.2: Run test to verify failure**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- RolloverBanner 2>&1 | tail -10
```

Expected: walletTopup-line case FAILS (line not rendered yet); others pass.

- [ ] **Step 8.3: Add the wallet-topup line + new props**

In `packages/frontend/src/components/curve/RolloverBanner.jsx`, extend the prop list and the JSX. After the existing `enabled && (...)` block that renders `rolloverFormatted` + bonus (around lines 83-94), append a sibling block:

```jsx
      {enabled && walletTopupTickets > 0n && (
        <div className="mt-2 pt-2 border-t border-emerald-500/20 space-y-1 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>{t("raffle:walletTopupLine")}</span>
            <span>{formatUnits(walletTopupSof, 18)} SOF</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>{t("raffle:walletTopupTickets")}</span>
            <span>{String(walletTopupTickets)}</span>
          </div>
        </div>
      )}
```

Add the three new propTypes:
```js
  estBuyWithFees: PropTypes.any,
  walletTopupSof: PropTypes.any,
  walletTopupTickets: PropTypes.any,
```

And accept defaults in the function signature:
```jsx
export default function RolloverBanner({
  rolloverBalance,
  bonusBps,
  bonusAmount,
  sourceSeasonId,
  enabled,
  onEnabledChange,
  rolloverAmount,
  onRolloverAmountChange,
  estBuyWithFees = 0n,        // NEW
  walletTopupSof = 0n,        // NEW
  walletTopupTickets = 0n,    // NEW
}) {
```

- [ ] **Step 8.4: Add i18n strings**

In `packages/frontend/src/locales/en/raffle.json` (or wherever raffle strings live — `grep -rn '"rolloverFromSeason"' packages/frontend/src/locales` to find), add:

```json
"walletTopupLine": "+ from wallet",
"walletTopupTickets": "Top-up tickets"
```

If multiple locale files exist, add to each (English may be the only one populated; others are typically defaultValue fallback).

- [ ] **Step 8.5: Run test to verify pass**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test -- RolloverBanner 2>&1 | tail -10
```

Expected: 3/3 pass.

- [ ] **Step 8.6: Commit**

```bash
cd /Users/psd/Projects/SOf/sof-beta && git add packages/frontend/src/components/curve/RolloverBanner.jsx packages/frontend/src/locales packages/frontend/tests/components/RolloverBanner.test.jsx && git commit -m "$(cat <<'EOF'
feat(frontend): RolloverBanner wallet-topup line for mixed-batch buys

When the buy size exceeds the rollover balance and a wallet top-up
fills the gap, the banner now shows a sibling line documenting the
wallet-funded SOF + ticket count so the user understands exactly what
the userOp will execute.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Full frontend test sweep + lint + version bump

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 9.1: Run the entire frontend suite**

```bash
cd /Users/psd/Projects/SOf/sof-beta/packages/frontend && npm test 2>&1 | grep -E "Test Files|Tests" | tail -5
```

Expected: target **402/402 pass** (396 baseline + 6 new). If lower, an existing test broke — read the failure, fix the mock or assertion, re-run.

- [ ] **Step 9.2: Lint clean**

```bash
npm run lint 2>&1 | tail -5
```

Expected: zero warnings, zero errors.

- [ ] **Step 9.3: Bump version (minor: new component surface)**

```bash
cd /Users/psd/Projects/SOf/sof-beta && npm version minor --workspace @sof/frontend --no-git-tag-version 2>&1 | tail -2
```

Expected: `0.33.0 → 0.34.0`.

- [ ] **Step 9.4: Commit version + push**

```bash
git add packages/frontend/package.json package-lock.json && git commit -m "$(cat <<'EOF'
chore: bump @sof/frontend 0.33.0 → 0.34.0 for spend-from-rollover UI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git push 2>&1 | tail -3
```

---

## Task 10 — Manual testnet smoke + finalize PR

- [ ] **Step 10.1:** Wait for Vercel PR preview to rebuild on the latest push. Open the preview URL from the PR.

- [ ] **Step 10.2:** Connect Player 1's wallet (`0x2146…D5ab`, SMA `0x3C57…F18Fd`). P1 currently has 455 SOF rollover deposited in cohort 1 (verified on testnet 2026-05-15).

- [ ] **Step 10.3:** Navigate to season 2 detail page. Verify:
  - RolloverBanner appears (was hidden before this PR).
  - Banner reads "Rolling over 455 SOF + 27.3 SOF bonus from season 1".

- [ ] **Step 10.4:** Type a small buy (e.g., 100 tickets). Verify:
  - Banner stays in **rollover-only** mode (rollover covers it).
  - Submit fires a single-call `spendFromRollover` userOp.
  - P1's wallet SOF balance is unchanged after the tx; rollover balance drops.

- [ ] **Step 10.5:** Type a larger buy (e.g., 500 tickets, exceeds remaining rollover). Verify:
  - Banner shows the new "+ X SOF from wallet → Y tickets" line.
  - Submit fires a 3-call mixed-batch userOp.
  - P1's wallet SOF balance drops by the top-up amount; rollover balance hits zero (or close).

- [ ] **Step 10.6:** Toggle the rollover switch OFF. Verify:
  - Buy submit fires the wallet-only 2-call userOp (existing behavior preserved).

- [ ] **Step 10.7:** Mark PR ready + merge per `github-pr-workflow`:

```bash
gh pr ready  # PR number is the most recent one for this branch
# After CI green and any review:
gh pr merge --squash --delete-branch
git checkout main && git fetch origin && git reset --hard origin/main
```

---

## Self-review checklist

**Spec coverage:**
- Section 1 Architecture → Task 2 + Task 7 (hook + widget wiring) ✓
- Section 2 Components: `useEligibleRolloverCohort` shape → Task 2 ✓
- Section 2 `executeBuy` branch table → Task 4 ✓
- Section 2 `RolloverBanner` refresh → Task 8 ✓
- Section 2 `useBalanceValidation` tweak → Task 5 ✓
- Section 3 Read path → Task 2 (hook reads cohort + balance) ✓
- Section 3 Write path → Task 4 (3-call batch) + Task 7 (widget wires walletTopup* through handlers) + Task 6 (handler thread-through) ✓
- Section 3 Error handling rows → covered by existing `useBuySellTransactions` error catch (no new code needed; PhaseNotActive/ExceedsBalance fall through `parseClaimError` already used in other claim hooks)
- Section 4 Testing (6 new + ~3 modified) → Tasks 2, 3, 4, 5, 8 ✓
- Files-changed list at the bottom of spec → matches Tasks 1-9 ✓

**Placeholder scan:** no TBD/TODO; every code block has actual content; every command has expected output.

**Type consistency:**
- Hook returns `cohortSeasonId: bigint | null, available, bonusBps, bonusAmount, isEligible, isLoading, error` → matches what BuySellWidget destructures in Task 7 ✓
- `executeBuy` accepts `walletTopupTickets` + `walletTopupMaxSof` → matches what `useTransactionHandlers` forwards (Task 6) and what widget computes (Task 7) ✓
- `RolloverBanner` adds `estBuyWithFees, walletTopupSof, walletTopupTickets` → matches widget JSX in Task 7 + propTypes/destructure in Task 8 ✓
- `useBalanceValidation` 5th param `rolloverEffectiveAmount` → matches widget call in Task 7 ✓
- `computeBuySplit` returns `rolloverTickets, walletTopupTickets, walletTopupSofBase` → matches widget destructure in Task 7 ✓
