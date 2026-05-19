# Transaction Modal Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every on-chain transaction notification through the existing `admin/TransactionModal` centered Dialog so the user sees one consistent UI (pending → confirming → confirmed/error with full-error panel) instead of three different ones (Radix Toaster, inline `<Alert>`, modal).

**Architecture:** Add one `useTransactionStatus(mutation)` adapter that wraps any wagmi `useMutation` returning a tx hash, polls `waitForTransactionReceipt`, and exposes the modal-shaped object the existing `TransactionModal` already consumes. Refactor `useBuySellTransactions` to expose mutation-shaped state instead of an `onNotify` callback. Each call site mounts `<TransactionModal>` next to its trigger button. The legacy inline `<Alert>` stack in `RaffleDetails.jsx` and the per-flow `toast()` calls in claims/rollover/sponsor/treasury are deleted.

**Tech Stack:** React 18, wagmi v2, @tanstack/react-query v5, viem, vitest, @testing-library/react, shadcn-ui (Radix Dialog).

---

## File Structure

**Create:**
- `packages/frontend/src/hooks/useTransactionStatus.js` — adapter hook
- `packages/frontend/src/hooks/__tests__/useTransactionStatus.test.jsx` — hook tests

**Modify:**
- `packages/frontend/src/lib/contractErrors.js` — add `extractErrorDetails()` sibling of existing `extractErrorData()`
- `packages/frontend/src/components/admin/TransactionModal.jsx` — scroll fix; import shared util; rename file path note (still admin/-located until a future move, since import sites are widespread)
- `packages/frontend/src/hooks/buysell/useBuySellTransactions.js` — drop `onNotify` param; expose `buyMutation`, `sellMutation` shaped as wagmi mutations
- `packages/frontend/src/hooks/buysell/useTransactionHandlers.js` — adapt to new `useBuySellTransactions` shape
- `packages/frontend/src/components/curve/BuySellWidget.jsx` — drop `onNotify` prop; mount `<TransactionModal>` for each mutation
- `packages/frontend/src/routes/RaffleDetails.jsx` — delete local `toasts` state, `addToast` function, inline `<Alert>` stack
- `packages/frontend/src/components/mobile/BuySellSheet.jsx` — drop `onNotify`, drop fallback `toast()`, mount `<TransactionModal>`
- `packages/frontend/src/components/infofi/BuySellWidget.jsx` — drop `useToast` import + `toast()` calls; mount `<TransactionModal>` around `placeBet` mutation
- `packages/frontend/src/hooks/useClaims.js` — drop `toast()` from `onError` blocks (modal owns error display)
- `packages/frontend/src/components/infofi/ClaimCenter.jsx` — wrap each claim mutation with `useTransactionStatus`; mount one `<TransactionModal>` per active mutation
- `packages/frontend/src/hooks/useRollover.js` — drop `toast()` from `onSuccess`/`onError` blocks
- `packages/frontend/src/components/raffle/ConsolationClaimAction.jsx` — wrap `claimToRollover` with `useTransactionStatus`; mount `<TransactionModal>`
- `packages/frontend/src/components/user/RolloverPortfolioCard.jsx` — wrap `refundRollover` with `useTransactionStatus`; mount `<TransactionModal>`
- `packages/frontend/src/components/prizes/ClaimPrizeWidget.jsx` — replace `useSponsorPrizeClaim` `{onSuccess,onError}` toast callbacks with `useTransactionStatus` adapter + `<TransactionModal>`
- `packages/frontend/src/hooks/useSponsorPrize.js` — drop `{onSuccess,onError}` callback props (no longer needed)
- `packages/frontend/src/components/admin/TreasuryControls.jsx` — wrap `extractMutation` (via new `useTreasury` return) with `useTransactionStatus`; mount `<TransactionModal>`. Keep inline `extractError` Alert removed (modal owns it).
- `packages/frontend/src/hooks/useTreasury.js` — expose `extractMutation` directly so the component can wrap it with `useTransactionStatus`
- `packages/frontend/src/components/admin/GroupsPanel.jsx` — fix import path `@/hooks/use-toast` → `@/hooks/useToast`
- `packages/frontend/src/components/admin/RouteAccessPanel.jsx` — fix import path `@/hooks/use-toast` → `@/hooks/useToast`
- `packages/frontend/package.json` — bump version to `0.37.0`

**No delete:** `MobileToast.jsx` was already deleted in commit `efccbe3` (carried onto this branch from main working tree).

---

## Task 1 — Modal scroll fix

**Files:**
- Modify: `packages/frontend/src/components/admin/TransactionModal.jsx`

When the user expands the "Full error" `<details>` block, the modal currently grows past the viewport because there is no `max-height` on `DialogContent` and no scroll containment on the `<pre>` blocks. Cap the modal at 85vh, make the content area scrollable, and limit each `<pre>` to a finite height with its own scroll.

- [ ] **Step 1.1: Cap DialogContent and scroll the body**

Edit `packages/frontend/src/components/admin/TransactionModal.jsx`:

Find at line 177:

```jsx
      <DialogContent className="sm:max-w-md">
```

Replace with:

```jsx
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
```

Find at line 203:

```jsx
        <div className="flex flex-col items-center gap-4 py-4">
```

Replace with:

```jsx
        <div className="flex flex-col items-center gap-4 py-4 overflow-y-auto flex-1 min-h-0">
```

- [ ] **Step 1.2: Cap the error `<pre>` blocks**

Find at line 222-226 (Contract call details `<pre>`):

```jsx
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-2">
                    {status.details.contractContext}
                  </pre>
```

Replace with:

```jsx
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-2 max-h-48 overflow-auto">
                    {status.details.contractContext}
                  </pre>
```

Find at line 233-235 (Full error `<pre>`):

```jsx
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-2">
                    {status.details.fullMessage}
                  </pre>
```

Replace with:

```jsx
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-2 max-h-48 overflow-auto">
                    {status.details.fullMessage}
                  </pre>
```

- [ ] **Step 1.3: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS, no warnings.

- [ ] **Step 1.4: Commit**

```bash
git add packages/frontend/src/components/admin/TransactionModal.jsx
git commit -m "fix(frontend): TransactionModal scroll containment on expand"
```

---

## Task 2 — Extract `extractErrorDetails` into shared `lib/contractErrors.js`

**Files:**
- Modify: `packages/frontend/src/lib/contractErrors.js`
- Modify: `packages/frontend/src/components/admin/TransactionModal.jsx`

`extractErrorDetails()` is currently private to `TransactionModal.jsx` but new BuySell pre-flight errors need to flow through the same revert-walk logic. Move it to the existing `lib/contractErrors.js` as a sibling of `extractErrorData()`.

- [ ] **Step 2.1: Add `extractErrorDetails` to `lib/contractErrors.js`**

Edit `packages/frontend/src/lib/contractErrors.js`. Append at end of file:

```js
/**
 * Walk a viem error's cause chain to find the most-actionable revert reason.
 * viem wraps ContractFunctionRevertedError inside ContractFunctionExecutionError
 * inside the wagmi mutation error, so the headline `shortMessage` is usually a
 * generic "The contract function 'X' reverted" with the real reason ~2 layers
 * down. Returns { headline, reason, contractContext, fullMessage } or null.
 */
export function extractErrorDetails(err) {
  if (!err) return null;
  const headline = err.shortMessage || err.message || 'Transaction failed';
  let reason = null;
  let contractContext = null;
  let cur = err;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.data?.errorName && !reason) {
      const args = Array.isArray(cur.data.args) && cur.data.args.length
        ? `(${cur.data.args.map(String).join(', ')})`
        : '()';
      reason = `${cur.data.errorName}${args}`;
    }
    if (Array.isArray(cur.metaMessages) && cur.metaMessages.length && !contractContext) {
      contractContext = cur.metaMessages.join('\n');
    }
    if (!reason && cur !== err && cur.shortMessage && cur.shortMessage !== headline) {
      reason = cur.shortMessage;
    }
    cur = cur.cause;
  }
  return { headline, reason, contractContext, fullMessage: err.message || '' };
}
```

- [ ] **Step 2.2: Import in TransactionModal, delete local copy**

Edit `packages/frontend/src/components/admin/TransactionModal.jsx`:

Find at top of file (around line 1-14):

```jsx
// src/components/admin/TransactionModal.jsx
import { useState, useEffect, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { X, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
```

Add after the dialog import:

```jsx
import { extractErrorDetails } from "@/lib/contractErrors";
```

Then delete lines 16-52 (the local `extractErrorDetails` function and its JSDoc block).

- [ ] **Step 2.3: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add packages/frontend/src/lib/contractErrors.js packages/frontend/src/components/admin/TransactionModal.jsx
git commit -m "refactor(frontend): hoist extractErrorDetails into lib/contractErrors"
```

---

## Task 3 — Build `useTransactionStatus` adapter hook

**Files:**
- Create: `packages/frontend/src/hooks/useTransactionStatus.js`
- Test: `packages/frontend/src/hooks/__tests__/useTransactionStatus.test.jsx`

The hook takes any wagmi `useMutation` whose `mutationFn` returns a tx hash string and exposes the modal-shaped object `{ isPending, isConfirming, isConfirmed, isError, hash, error, receipt }`. It polls `client.waitForTransactionReceipt` once a hash is available.

- [ ] **Step 3.1: Write the failing tests**

Create `packages/frontend/src/hooks/__tests__/useTransactionStatus.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';

const mockWaitForReceipt = vi.fn();
vi.mock('wagmi', () => ({
  usePublicClient: () => ({ waitForTransactionReceipt: (...a) => mockWaitForReceipt(...a) }),
}));

import { useTransactionStatus } from '../useTransactionStatus';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function setup({ mutationImpl }) {
  const wrapper = makeWrapper();
  return renderHook(
    () => {
      const mutation = useMutation({ mutationFn: mutationImpl });
      const status = useTransactionStatus(mutation);
      return { mutation, status };
    },
    { wrapper }
  );
}

describe('useTransactionStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('idle state mirrors mutation idle', () => {
    const { result } = setup({ mutationImpl: async () => '0xhash' });
    expect(result.current.status).toMatchObject({
      isPending: false,
      isConfirming: false,
      isConfirmed: false,
      isError: false,
      hash: null,
    });
  });

  it('pending → confirming → confirmed', async () => {
    mockWaitForReceipt.mockResolvedValue({ status: 'success', transactionHash: '0xhash' });
    const { result } = setup({ mutationImpl: async () => '0xhash' });

    await act(async () => {
      result.current.mutation.mutate();
    });

    await waitFor(() => expect(result.current.status.isConfirmed).toBe(true));
    expect(result.current.status).toMatchObject({
      isPending: false,
      isConfirming: false,
      isConfirmed: true,
      isError: false,
      hash: '0xhash',
      receipt: { status: 'success', transactionHash: '0xhash' },
    });
    expect(mockWaitForReceipt).toHaveBeenCalledWith({ hash: '0xhash', confirmations: 1 });
  });

  it('reverted receipt surfaces as isConfirmed with reverted status', async () => {
    mockWaitForReceipt.mockResolvedValue({ status: 'reverted', transactionHash: '0xhash' });
    const { result } = setup({ mutationImpl: async () => '0xhash' });

    await act(async () => {
      result.current.mutation.mutate();
    });

    await waitFor(() => expect(result.current.status.isConfirmed).toBe(true));
    expect(result.current.status.receipt.status).toBe('reverted');
  });

  it('mutation throw surfaces as isError', async () => {
    const err = new Error('user rejected');
    const { result } = setup({ mutationImpl: async () => { throw err; } });

    await act(async () => {
      try { await result.current.mutation.mutateAsync(); } catch { /* expected */ }
    });

    await waitFor(() => expect(result.current.status.isError).toBe(true));
    expect(result.current.status.error).toBe(err);
    expect(result.current.status.hash).toBeNull();
    expect(mockWaitForReceipt).not.toHaveBeenCalled();
  });

  it('waitForTransactionReceipt throw surfaces as isError with hash retained', async () => {
    const err = new Error('rpc dropped');
    mockWaitForReceipt.mockRejectedValue(err);
    const { result } = setup({ mutationImpl: async () => '0xhash' });

    await act(async () => {
      result.current.mutation.mutate();
    });

    await waitFor(() => expect(result.current.status.isError).toBe(true));
    expect(result.current.status.hash).toBe('0xhash');
    expect(result.current.status.error).toBe(err);
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useTransactionStatus.test.jsx`
Expected: FAIL — `Cannot find module '../useTransactionStatus'`.

- [ ] **Step 3.3: Implement the hook**

Create `packages/frontend/src/hooks/useTransactionStatus.js`:

```js
import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';

/**
 * Adapter that turns any wagmi `useMutation` whose `mutationFn` returns a
 * transaction hash string into the shape `TransactionModal` consumes:
 *   { isPending, isConfirming, isConfirmed, isError, hash, error, receipt }
 *
 * Lifecycle:
 *   mutation.isPending true            → isPending=true  (wallet sign / batch dispatch)
 *   mutation.isSuccess true, no receipt → isConfirming=true (waiting for block)
 *   receipt arrives                     → isConfirmed=true with receipt.status
 *   mutation throws                     → isError=true (no receipt poll)
 *   waitForTransactionReceipt throws    → isError=true with hash retained
 *
 * The mutationFn MUST return a string hash (e.g. the return of executeBatch).
 * Returning anything else short-circuits the receipt poll.
 */
export function useTransactionStatus(mutation) {
  const client = usePublicClient();
  const [receipt, setReceipt] = useState(null);
  const [waitError, setWaitError] = useState(null);

  const hash = typeof mutation?.data === 'string' ? mutation.data : null;

  useEffect(() => {
    if (!hash || !client) return;
    let cancelled = false;
    setReceipt(null);
    setWaitError(null);
    client
      .waitForTransactionReceipt({ hash, confirmations: 1 })
      .then((r) => { if (!cancelled) setReceipt(r); })
      .catch((e) => { if (!cancelled) setWaitError(e); });
    return () => { cancelled = true; };
  }, [hash, client]);

  // Reset local state when mutation resets (idle).
  useEffect(() => {
    if (mutation?.status === 'idle') {
      setReceipt(null);
      setWaitError(null);
    }
  }, [mutation?.status]);

  const isPending = !!mutation?.isPending;
  const isConfirming = !!hash && !receipt && !waitError && !mutation?.isError;
  const isConfirmed = !!receipt;
  const isError = !!(mutation?.isError || waitError);

  return {
    isPending,
    isConfirming,
    isConfirmed,
    isError,
    hash,
    error: mutation?.error ?? waitError ?? null,
    receipt,
  };
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useTransactionStatus.test.jsx`
Expected: PASS — 5 tests.

- [ ] **Step 3.5: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add packages/frontend/src/hooks/useTransactionStatus.js packages/frontend/src/hooks/__tests__/useTransactionStatus.test.jsx
git commit -m "feat(frontend): useTransactionStatus adapter for TransactionModal"
```

---

## Task 4 — Refactor `useBuySellTransactions` to expose mutation-shaped state

**Files:**
- Modify: `packages/frontend/src/hooks/buysell/useBuySellTransactions.js`
- Modify: `packages/frontend/src/hooks/buysell/useTransactionHandlers.js`

Convert `executeBuy`/`executeSell` from custom `isPending` + `onNotify` callback to a pair of wagmi `useMutation`s. The `mutationFn` either returns the hash (success) or throws an `Error` (including pre-flight failures). Drop the `onNotify` param entirely. Keep the `onTxSuccess` separate-channel callback (already used by RaffleDetails for `triggerStaggeredRefresh`).

- [ ] **Step 4.1: Rewrite `useBuySellTransactions.js`**

Replace the entire file `packages/frontend/src/hooks/buysell/useBuySellTransactions.js` with:

```js
/**
 * useBuySellTransactions Hook
 *
 * Single-path buy/sell flow. All writes go through useSmartTransactions.executeBatch
 * which routes by wallet type:
 *   - desktop-EOA  → Path A: counterfactual SMA + EntryPoint v0.8 UserOp + paymaster
 *   - Coinbase     → wallet_sendCalls + CDP paymaster
 *   - Farcaster    → wallet_sendCalls + paymaster capability
 *
 * Exposes wagmi-mutation-shaped state for each operation so callers can wrap
 * with useTransactionStatus and feed TransactionModal. Pre-flight errors
 * throw rather than bypass — the mutation owns the error channel.
 */

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { encodeFunctionData } from "viem";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { applyMaxSlippage, applyMinSlippage } from "@/utils/buysell/slippage";
import { SOFBondingCurveAbi, ERC20Abi } from "@/utils/abis";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * @param {string} bondingCurveAddress
 * @param {Object} client - Viem public client (used for pre-flight reserves check)
 * @param {Function} [onSuccess] - Fired after a tx hash is returned (does NOT wait for receipt)
 * @returns {{ buyMutation, sellMutation }} wagmi useMutation handles
 */
export function useBuySellTransactions(
  bondingCurveAddress,
  client,
  onSuccess,
) {
  const contracts = getContractAddresses(getStoredNetworkKey());
  const { executeBatch } = useSmartTransactions();

  const buildBuyCalls = useCallback(
    ({
      tokenAmount,
      maxSofAmount,
      slippagePct,
      rolloverSeasonId,
      rolloverAmount,
      walletTopupTickets = 0n,
      walletTopupMaxSof = 0n,
      rolloverMaxTotalSof = 0n,
    }) => {
      const cap = applyMaxSlippage(maxSofAmount, slippagePct);
      const hasRollover = rolloverSeasonId && rolloverAmount > 0n;
      const hasWalletTopup = hasRollover && walletTopupTickets > 0n;
      const rolloverTickets = hasWalletTopup ? tokenAmount - walletTopupTickets : 0n;
      return { cap, hasRollover, hasWalletTopup, rolloverTickets };
    },
    [],
  );

  const buyMutation = useMutation({
    mutationFn: async (params) => {
      const {
        tokenAmount,
        slippagePct,
        rolloverSeasonId,
        rolloverAmount,
        walletTopupTickets = 0n,
        walletTopupMaxSof = 0n,
        rolloverMaxTotalSof = 0n,
      } = params;
      const { cap, hasRollover, hasWalletTopup, rolloverTickets } = buildBuyCalls(params);

      let calls;
      if (hasWalletTopup && rolloverTickets > 0n) {
        const { buildSpendFromRolloverCall } = await import("@/services/onchainRolloverEscrow");
        calls = [
          buildSpendFromRolloverCall({
            seasonId: rolloverSeasonId,
            sofAmount: rolloverAmount,
            ticketAmount: rolloverTickets,
            maxTotalSof: rolloverMaxTotalSof > 0n
              ? rolloverMaxTotalSof
              : rolloverAmount + (rolloverAmount * 1000n) / 10000n,
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
      } else if (hasRollover && !hasWalletTopup) {
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
      return hash || "";
    },
    onSuccess: () => { onSuccess?.(); },
  });

  const sellMutation = useMutation({
    mutationFn: async ({ tokenAmount, minSofAmount, slippagePct }) => {
      const floor = applyMinSlippage(minSofAmount, slippagePct);

      // Pre-flight reserves check — throw so the modal shows the reason.
      if (client && bondingCurveAddress) {
        const cfg = await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "curveConfig",
          args: [],
        });
        if (cfg[1] /* sofReserves */ < minSofAmount) {
          throw new Error("Insufficient curve reserves — cannot sell this amount");
        }
      }

      const hash = await executeBatch(
        [{
          to: bondingCurveAddress,
          data: encodeFunctionData({
            abi: SOFBondingCurveAbi,
            functionName: "sellTokens",
            args: [tokenAmount, floor],
          }),
        }],
        { sofAmount: floor },
      );
      return hash || "";
    },
    onSuccess: () => { onSuccess?.(); },
  });

  return { buyMutation, sellMutation };
}
```

- [ ] **Step 4.2: Update `useTransactionHandlers.js` to use the new shape**

Read the current file first:

Run: `cat packages/frontend/src/hooks/buysell/useTransactionHandlers.js`

Then edit to: (a) drop the `onNotify` param, (b) replace `executeBuy(...)` calls with `buyMutation.mutateAsync(...)`, (c) replace `executeSell(...)` with `sellMutation.mutateAsync(...)`, (d) catch and rethrow errors so callers can still observe success/failure but the mutation owns the user-visible state. Remove all `onNotify?.({...})` calls — they're no longer the channel. Specific edits depend on current handler contents; preserve `triggerStaggeredRefresh` wiring via `onTxSuccess`.

**Concrete edits to make in `useTransactionHandlers.js`**:

Replace the `onNotify` parameter in the destructured args (line 19) — delete the `onNotify,` line.

Replace `executeBuy,` and `executeSell,` (lines around 25-26) with `buyMutation,` and `sellMutation,`.

Replace every `onNotify?.({ type: "error", message: <msg>, hash: "" })` block with `throw new Error(<msg>)`. The mutation that wraps this will catch the throw and surface it as `mutation.error`.

Replace every `onNotify?.({ type: "success", ... })` call with a plain `return { success: true }` (or remove if unreachable) — success is now expressed via `mutation.isSuccess`.

Replace `await executeBuy({...})` with `await buyMutation.mutateAsync({...})`. Same for sell.

Remove `onNotify` from each `useCallback` dependency array.

- [ ] **Step 4.3: Update `useBuySellTransactions` import in `BuySellWidget.jsx` (both curve and mobile/InfoFi)**

Edit `packages/frontend/src/components/curve/BuySellWidget.jsx`:

Find at line 193-198:

```jsx
  const { executeBuy, executeSell, isPending } = useBuySellTransactions(
    bondingCurveAddress,
    client,
    onNotify,
    onTxSuccess
  );
```

Replace with:

```jsx
  const { buyMutation, sellMutation } = useBuySellTransactions(
    bondingCurveAddress,
    client,
    onTxSuccess,
  );
  const isPending = buyMutation.isPending || sellMutation.isPending;
```

Find at line 200-223 (the `useTransactionHandlers` call):

Replace the `executeBuy` and `executeSell` keys in the args object with `buyMutation` and `sellMutation`. Delete the `onNotify,` key. Keep everything else.

- [ ] **Step 4.4: Run buysell tests**

Run: `cd packages/frontend && npx vitest run tests/hooks/buysell src/hooks/__tests__/useTransactionStatus.test.jsx`
Expected: PASS.

- [ ] **Step 4.5: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add packages/frontend/src/hooks/buysell/useBuySellTransactions.js packages/frontend/src/hooks/buysell/useTransactionHandlers.js packages/frontend/src/components/curve/BuySellWidget.jsx
git commit -m "refactor(frontend): useBuySellTransactions exposes mutation-shaped state"
```

---

## Task 5 — Migrate curve `BuySellWidget` + `RaffleDetails` to TransactionModal

**Files:**
- Modify: `packages/frontend/src/components/curve/BuySellWidget.jsx`
- Modify: `packages/frontend/src/routes/RaffleDetails.jsx`

Drop the `onNotify` prop entirely. Mount `<TransactionModal>` inside `BuySellWidget` next to the tabs. Delete the local `toasts` state + `addToast` function + inline `<Alert>` stack from `RaffleDetails.jsx`.

- [ ] **Step 5.1: Drop `onNotify` from BuySellWidget propTypes + signature**

Edit `packages/frontend/src/components/curve/BuySellWidget.jsx`:

Find at line 32-41 (component signature):

```jsx
const BuySellWidget = ({
  bondingCurveAddress,
  onTxSuccess,
  onNotify,
  initialTab,
  isGated = false,
  isVerified = null,
  onGatingRequired,
  seasonId,
}) => {
```

Replace with:

```jsx
const BuySellWidget = ({
  bondingCurveAddress,
  onTxSuccess,
  initialTab,
  isGated = false,
  isVerified = null,
  onGatingRequired,
  seasonId,
}) => {
```

Find at line 460-469 (propTypes):

```jsx
BuySellWidget.propTypes = {
  bondingCurveAddress: PropTypes.string,
  onTxSuccess: PropTypes.func,
  onNotify: PropTypes.func,
  initialTab: PropTypes.oneOf(["buy", "sell"]),
  isGated: PropTypes.bool,
  isVerified: PropTypes.bool,
  onGatingRequired: PropTypes.func,
  seasonId: PropTypes.any,
};
```

Replace with (delete `onNotify` line):

```jsx
BuySellWidget.propTypes = {
  bondingCurveAddress: PropTypes.string,
  onTxSuccess: PropTypes.func,
  initialTab: PropTypes.oneOf(["buy", "sell"]),
  isGated: PropTypes.bool,
  isVerified: PropTypes.bool,
  onGatingRequired: PropTypes.func,
  seasonId: PropTypes.any,
};
```

- [ ] **Step 5.2: Mount TransactionModal inside BuySellWidget**

Add to the imports at top of `packages/frontend/src/components/curve/BuySellWidget.jsx`:

```jsx
import TransactionModal from "@/components/admin/TransactionModal";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
```

After the `useBuySellTransactions` block (around the line replaced in Task 4.3), add:

```jsx
  const buyStatus = useTransactionStatus(buyMutation);
  const sellStatus = useTransactionStatus(sellMutation);
```

Inside the returned JSX, immediately after the closing `</Tabs>` (around line 455) and before the closing `</div>`, insert:

```jsx
      <TransactionModal mutation={buyStatus} title={t("transactions:buying", { defaultValue: "Buying tickets" })} />
      <TransactionModal mutation={sellStatus} title={t("transactions:selling", { defaultValue: "Selling tickets" })} />
```

- [ ] **Step 5.3: Delete RaffleDetails toast plumbing**

Edit `packages/frontend/src/routes/RaffleDetails.jsx`:

Delete lines 164-178 (the entire toast/addToast block):

```jsx
  // Toasts state for tx updates (component scope)
  const [toasts, setToasts] = useState([]);
  const netKeyOuter = getStoredNetworkKey();
  const netOuter = getNetworkByKey(netKeyOuter);
  const addToast = ({ type = "success", message, hash }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url =
      hash && netOuter?.explorer
        ? `${netOuter.explorer.replace(/\/$/, "")}/tx/${hash}`
        : undefined;
    setToasts((t) => [{ id, type, message, hash, url }, ...t]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 120000); // 2 minutes
  };
```

Delete the inline Alert stack at lines 691-712:

```jsx
                        {/* Toasts container (inline under position) */}
                        {toasts.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {toasts.map((toast) => (
                              <Alert
                                key={toast.id}
                                variant={toast.type === "error" ? "destructive" : "success"}
                              >
                                <AlertTitle>{toast.message}</AlertTitle>
                                {toast.hash && (
                                  <AlertDescription>
                                    <ExplorerLink
                                      value={toast.hash}
                                      type="tx"
                                      text="View Transaction"
                                      className="underline text-primary font-mono break-all"
                                    />
                                  </AlertDescription>
                                )}
                              </Alert>
                            ))}
                          </div>
                        )}
```

Delete the `onNotify` callback wired into the desktop `<BuySellWidget>` at lines 633-636:

```jsx
                            onNotify={(evt) => {
                              addToast(evt);
                              triggerStaggeredRefresh();
                            }}
```

Delete the `onNotify` callback wired into the mobile `<BuySellSheet>` at lines 338-350 — but keep the `position_update` branch since that's a sheet→parent state push, not a toast:

Find:

```jsx
          onNotify={(evt) => {
            // Handle position updates from sheet (don't close sheet)
            if (evt.type === "position_update" && evt.positionData) {
              setLocalPosition(evt.positionData);
              return;
            }

            // Handle other notifications
            addToast(evt);
            setIsRefreshing(true);
            debouncedRefresh(0);
            refreshPositionNow();
          }}
```

Replace with:

```jsx
          onPositionUpdate={(positionData) => {
            setLocalPosition(positionData);
          }}
          onTxSettled={() => {
            setIsRefreshing(true);
            debouncedRefresh(0);
            refreshPositionNow();
          }}
```

(This shifts the surviving non-toast responsibilities into two purpose-named callbacks. We'll wire these props in Task 6 when migrating BuySellSheet.)

- [ ] **Step 5.4: Remove now-unused imports**

Edit `packages/frontend/src/routes/RaffleDetails.jsx`. If `Alert`, `AlertDescription`, `AlertTitle` are no longer used anywhere else in this file, remove the import at line 14. Same for `ExplorerLink` (line 34) — keep only if used elsewhere in file. Same for `getStoredNetworkKey`, `getNetworkByKey` from line 167 — keep only if used elsewhere. Run `npm run lint` and let ESLint catch dangling ones.

- [ ] **Step 5.5: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS. Fix any unused-import warnings.

- [ ] **Step 5.6: Commit**

```bash
git add packages/frontend/src/components/curve/BuySellWidget.jsx packages/frontend/src/routes/RaffleDetails.jsx
git commit -m "feat(frontend): curve BuySellWidget + RaffleDetails use TransactionModal"
```

---

## Task 6 — Migrate mobile `BuySellSheet` to TransactionModal

**Files:**
- Modify: `packages/frontend/src/components/mobile/BuySellSheet.jsx`

Drop the `useToast` import and `onNotify` prop. Mount `<TransactionModal>` for buy and sell mutations. Wire the new `onPositionUpdate` + `onTxSettled` props introduced in Task 5.3.

- [ ] **Step 6.1: Refactor BuySellSheet**

Edit `packages/frontend/src/components/mobile/BuySellSheet.jsx`:

Replace the `useToast` import (line 44) — delete it.

Replace the `useBuySellTransactions` call (around line 200) the same way as Task 4.3 — destructure `buyMutation, sellMutation` instead of `executeBuy, executeSell, isPending`. Compute `isPending` from the two mutations.

Replace the `useTransactionHandlers` call accordingly (Task 4.3 style).

Replace the `toast({...})` call at line 252 with: nothing — the mutation owns the error display now. Delete the entire `else if (result && !result.success) { toast({...}); }` block. The mutation's error will surface in the TransactionModal.

Change the component signature: replace `onNotify` with `onPositionUpdate` and `onTxSettled`. Update propTypes similarly.

Inside the rendered JSX, near the end (before the sheet's closing tag), mount:

```jsx
      <TransactionModal mutation={buyStatus} title={t("transactions:buying", { defaultValue: "Buying tickets" })} />
      <TransactionModal mutation={sellStatus} title={t("transactions:selling", { defaultValue: "Selling tickets" })} />
```

Add the matching `useTransactionStatus` calls and import line (same as Task 5.2).

Wire `useEffect` to call `onTxSettled?.()` when either `buyMutation.isSuccess || buyMutation.isError || sellMutation.isSuccess || sellMutation.isError` transitions to true. This preserves the refresh-on-settle side effect that previously fired via `onNotify`.

- [ ] **Step 6.2: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 6.3: Commit**

```bash
git add packages/frontend/src/components/mobile/BuySellSheet.jsx
git commit -m "feat(frontend): mobile BuySellSheet uses TransactionModal"
```

---

## Task 7 — Migrate InfoFi `BuySellWidget` (placeBet) to TransactionModal

**Files:**
- Modify: `packages/frontend/src/components/infofi/BuySellWidget.jsx`

The `placeBet` mutation is already a wagmi `useMutation` returning the hash. Wrap with `useTransactionStatus`; mount `<TransactionModal>`; delete the `useToast` import and the two `toast()` calls.

- [ ] **Step 7.1: Refactor InfoFi BuySellWidget**

Edit `packages/frontend/src/components/infofi/BuySellWidget.jsx`:

Delete the `useToast` import (line 11).

Delete the line `const { toast } = useToast();` (line 26).

Add imports:

```jsx
import TransactionModal from '@/components/admin/TransactionModal';
import { useTransactionStatus } from '@/hooks/useTransactionStatus';
```

After the `placeBet` mutation declaration, add:

```jsx
  const placeBetStatus = useTransactionStatus(placeBet);
```

Delete the `toast({ title: t('betConfirmed'), ... })` call in `onSuccess` (lines 67-74). Keep the rest of `onSuccess` (query invalidations + `setAmount('')`).

Delete the `toast({ title: t('tradeFailed'), ... })` call in `onError` (lines 77-82). Delete the entire `onError` block since the modal owns error display.

Inside the returned JSX, near the end (before final closing tag), mount:

```jsx
      <TransactionModal mutation={placeBetStatus} title={t('placingBet', { defaultValue: 'Placing bet' })} />
```

- [ ] **Step 7.2: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add packages/frontend/src/components/infofi/BuySellWidget.jsx
git commit -m "feat(frontend): InfoFi BuySellWidget uses TransactionModal"
```

---

## Task 8 — Migrate claim flows (`useClaims`, `useSponsorPrize`) to TransactionModal

**Files:**
- Modify: `packages/frontend/src/hooks/useClaims.js`
- Modify: `packages/frontend/src/hooks/useSponsorPrize.js`
- Modify: `packages/frontend/src/components/infofi/ClaimCenter.jsx`
- Modify: `packages/frontend/src/components/prizes/ClaimPrizeWidget.jsx`

`useClaims` exposes 4 mutations; `useSponsorPrize` exposes 2. Each consumer (ClaimCenter, ClaimPrizeWidget) wraps the active mutation with `useTransactionStatus` and mounts a `TransactionModal`. Hook internal `toast()` calls and `{onSuccess,onError}` callback props are removed.

- [ ] **Step 8.1: Strip `toast()` from useClaims**

Edit `packages/frontend/src/hooks/useClaims.js`:

Delete the `useToast` import (line 5).

Delete `const { toast } = useToast();` (line 49).

Delete every `toast({ ... })` call inside `onError` blocks (lines 106-110, 149-153, 191-195, 232-236). Keep the rest of `onError` (the pendingClaims cleanup + query invalidation). Delete the `parseClaimError` import use inside `onError` if it's now unreferenced — but check: `parseClaimError` is also used to derive the `message` variable. Since we no longer surface that message, delete the `const message = parseClaimError(error);` line in each `onError` too. The error reaches the modal as `mutation.error` for `extractErrorDetails` to walk.

If `parseClaimError` is now entirely unused, delete the function definition (lines 11-40).

- [ ] **Step 8.2: Wire mutations to TransactionModals in ClaimCenter**

Edit `packages/frontend/src/components/infofi/ClaimCenter.jsx`:

Delete the `useToast` import (line 26) and `const { toast } = useToast();` (line 67).

Add imports:

```jsx
import TransactionModal from "@/components/admin/TransactionModal";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
```

After the `useClaims()` destructure (around line 78), add:

```jsx
  const claimInfoFiStatus = useTransactionStatus(claimInfoFiOne);
  const claimFPMMStatus = useTransactionStatus(claimFPMMOne);
  const claimConsolationStatus = useTransactionStatus(claimRaffleConsolation);
  const claimGrandStatus = useTransactionStatus(claimRaffleGrand);
```

Inside the returned JSX, near the top of the outer `<div>` (or wherever feels least intrusive — likely just after the `<Tabs>` element or right above `<CardContent>`), mount:

```jsx
      <TransactionModal mutation={claimInfoFiStatus} title={t("market:claimingInfoFi", { defaultValue: "Claiming InfoFi payout" })} />
      <TransactionModal mutation={claimFPMMStatus} title={t("market:claimingFPMM", { defaultValue: "Claiming market position" })} />
      <TransactionModal mutation={claimConsolationStatus} title={t("raffle:claimingConsolation", { defaultValue: "Claiming consolation" })} />
      <TransactionModal mutation={claimGrandStatus} title={t("raffle:claimingGrand", { defaultValue: "Claiming grand prize" })} />
```

Search the rest of the file for any leftover `toast(...)` calls and delete them too.

- [ ] **Step 8.3: Simplify useSponsorPrize**

Edit `packages/frontend/src/hooks/useSponsorPrize.js`:

Replace the entire file with:

```js
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredNetworkKey } from "@/lib/wagmi";
import {
  buildClaimSponsoredERC20Call,
  buildClaimSponsoredERC721Call,
} from "@/services/onchainRaffleDistributor";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";

/**
 * Hook for claiming sponsored prizes (ERC-20 and ERC-721).
 * Uses executeBatch for ERC-5792 gas sponsorship.
 * Consumers wrap the returned mutations with useTransactionStatus to drive
 * TransactionModal for UI feedback.
 */
export function useSponsorPrizeClaim(seasonId) {
  const netKey = getStoredNetworkKey();
  const queryClient = useQueryClient();
  const { executeBatch } = useSmartTransactions();

  const claimERC20Mutation = useMutation({
    mutationFn: async () => {
      const call = await buildClaimSponsoredERC20Call({ seasonId, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsoredERC20"] });
    },
  });

  const claimERC721Mutation = useMutation({
    mutationFn: async () => {
      const call = await buildClaimSponsoredERC721Call({ seasonId, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsoredERC721"] });
    },
  });

  const claimAll = async () => {
    const results = await Promise.allSettled([
      claimERC20Mutation.mutateAsync(),
      claimERC721Mutation.mutateAsync(),
    ]);
    return results;
  };

  return {
    claimERC20Mutation,
    claimERC721Mutation,
    claimERC20: claimERC20Mutation.mutate,
    claimERC721: claimERC721Mutation.mutate,
    claimAll,
    isClaimingERC20: claimERC20Mutation.isPending,
    isClaimingERC721: claimERC721Mutation.isPending,
    isClaiming: claimERC20Mutation.isPending || claimERC721Mutation.isPending,
  };
}
```

- [ ] **Step 8.4: Wire ClaimPrizeWidget to TransactionModal**

Edit `packages/frontend/src/components/prizes/ClaimPrizeWidget.jsx`:

Delete the `useToast` import (line 5).

Delete `const { toast } = useToast();` (line 43).

Replace the `useSponsorPrizeClaim(seasonId, {...})` call (lines 47-56) with:

```jsx
  const {
    claimAll: claimSponsoredAll,
    isClaiming: isClaimingSponsored,
    claimERC20Mutation,
    claimERC721Mutation,
  } = useSponsorPrizeClaim(seasonId);
```

Add imports:

```jsx
import TransactionModal from "@/components/admin/TransactionModal";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
```

After the `useSponsorPrizeClaim` destructure, add:

```jsx
  const claimERC20Status = useTransactionStatus(claimERC20Mutation);
  const claimERC721Status = useTransactionStatus(claimERC721Mutation);
```

Inside the returned JSX, before the closing `</CardContent>`, mount:

```jsx
            <TransactionModal mutation={claimERC20Status} title={t("raffle:claimingSponsoredERC20", { defaultValue: "Claiming sponsored tokens" })} />
            <TransactionModal mutation={claimERC721Status} title={t("raffle:claimingSponsoredNFT", { defaultValue: "Claiming sponsored NFT" })} />
```

- [ ] **Step 8.5: Lint check + run hook tests**

Run: `cd packages/frontend && npm run lint && npx vitest run src/hooks/__tests__`
Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add packages/frontend/src/hooks/useClaims.js packages/frontend/src/hooks/useSponsorPrize.js packages/frontend/src/components/infofi/ClaimCenter.jsx packages/frontend/src/components/prizes/ClaimPrizeWidget.jsx
git commit -m "feat(frontend): claim flows use TransactionModal"
```

---

## Task 9 — Migrate rollover flows (`useRollover`) to TransactionModal

**Files:**
- Modify: `packages/frontend/src/hooks/useRollover.js`
- Modify: `packages/frontend/src/components/raffle/ConsolationClaimAction.jsx`
- Modify: `packages/frontend/src/components/user/RolloverPortfolioCard.jsx`

Hook owns 3 mutations: `claimToRollover`, `spendFromRollover`, `refundRollover`. Strip the `toast()` calls; consumers (ConsolationClaimAction, RolloverPortfolioCard) wrap and mount TransactionModal. `spendFromRollover` is called from inside `useBuySellTransactions` (already covered by the buy modal in Task 5), so it doesn't need its own consumer modal.

- [ ] **Step 9.1: Strip `toast()` from useRollover**

Edit `packages/frontend/src/hooks/useRollover.js`:

Delete the `useToast` import (line 18).

Delete `const { toast } = useToast();` (line 27).

Delete the `useTranslation` import if `t` is now unreferenced (check the file after toast deletes).

In each of the 3 mutations (`claimToRollover`, `spendFromRollover`, `refundRollover`), delete the `toast({...})` calls inside `onSuccess` and `onError`. Keep the query invalidation logic. If `onSuccess`/`onError` blocks are now empty, delete them entirely.

- [ ] **Step 9.2: Wire ConsolationClaimAction to TransactionModal**

Edit `packages/frontend/src/components/raffle/ConsolationClaimAction.jsx`:

Add imports:

```jsx
import TransactionModal from "@/components/admin/TransactionModal";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
```

After the `useRollover(seasonId)` destructure, add:

```jsx
  const claimToRolloverStatus = useTransactionStatus(claimToRollover);
```

Inside the returned JSX, wrap the existing return in a fragment so we can mount the modal alongside:

```jsx
  if (!hasClaimableRollover) {
    return (
      <>
        <Button
          onClick={() => onClaimToWallet({ seasonId })}
          disabled={isPending}
          className="w-full"
        >
          {isPending
            ? t("transactions:claimInProgress", { defaultValue: "Claim in Progress..." })
            : t("raffle:claimPrize")}
        </Button>
      </>
    );
  }
```

(`<>...</>` is the React fragment.) Then in the `hasClaimableRollover` branch, wrap similarly and add:

```jsx
      <TransactionModal mutation={claimToRolloverStatus} title={t("raffle:rollingOver", { defaultValue: "Rolling over to next season" })} />
```

before the closing `</>`.

- [ ] **Step 9.3: Wire RolloverPortfolioCard to TransactionModal**

Edit `packages/frontend/src/components/user/RolloverPortfolioCard.jsx`:

Add imports:

```jsx
import TransactionModal from "@/components/admin/TransactionModal";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
```

After the `useRollover` destructure, add:

```jsx
  const refundStatus = useTransactionStatus(refundRollover);
```

Inside the returned JSX, before the closing `</CardContent>`, mount:

```jsx
        <TransactionModal mutation={refundStatus} title={t("account:refundingToWallet", { defaultValue: "Refunding to wallet" })} />
```

- [ ] **Step 9.4: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add packages/frontend/src/hooks/useRollover.js packages/frontend/src/components/raffle/ConsolationClaimAction.jsx packages/frontend/src/components/user/RolloverPortfolioCard.jsx
git commit -m "feat(frontend): rollover flows use TransactionModal"
```

---

## Task 10 — Migrate `TreasuryControls` fee-extract to TransactionModal

**Files:**
- Modify: `packages/frontend/src/hooks/useTreasury.js`
- Modify: `packages/frontend/src/components/admin/TreasuryControls.jsx`

`extractMutation` is wagmi-mutation-shaped already but not exposed directly. Expose it; consumer wraps with `useTransactionStatus` and mounts the modal.

- [ ] **Step 10.1: Expose `extractMutation` from useTreasury**

Edit `packages/frontend/src/hooks/useTreasury.js`:

Find the return block (lines 92-106):

```js
  return {
    accumulatedFees: formatEther(accumulatedFees),
    accumulatedFeesRaw: accumulatedFees,
    sofReserves: formatEther(sofReserves),
    sofReservesRaw: sofReserves,
    treasuryAddress,
    hasManagerRole,
    canExtractFees: hasManagerRole && accumulatedFees > 0n,
    extractFees: handleExtractFees,
    isExtracting: extractMutation.isPending,
    isExtractConfirmed: extractMutation.isSuccess,
    extractError: extractMutation.error,
    refetchAccumulatedFees: treasuryQuery.refetch,
    bondingCurveAddress,
  };
```

Add `extractMutation,` as a new return key (keep the existing keys for backwards compatibility with any other readers):

```js
  return {
    accumulatedFees: formatEther(accumulatedFees),
    accumulatedFeesRaw: accumulatedFees,
    sofReserves: formatEther(sofReserves),
    sofReservesRaw: sofReserves,
    treasuryAddress,
    hasManagerRole,
    canExtractFees: hasManagerRole && accumulatedFees > 0n,
    extractFees: handleExtractFees,
    extractMutation,
    isExtracting: extractMutation.isPending,
    isExtractConfirmed: extractMutation.isSuccess,
    extractError: extractMutation.error,
    refetchAccumulatedFees: treasuryQuery.refetch,
    bondingCurveAddress,
  };
```

- [ ] **Step 10.2: Wire TreasuryControls to TransactionModal**

Edit `packages/frontend/src/components/admin/TreasuryControls.jsx`:

Find the destructure of `useTreasury` (around line 34-35). Add `extractMutation,` to the destructured keys.

Add imports:

```jsx
import TransactionModal from "@/components/admin/TransactionModal";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
```

After the `useTreasury` destructure, add:

```jsx
  const extractStatus = useTransactionStatus(extractMutation);
```

Delete the `useToast` import (line 22) and `const { toast } = useToast();` (line 74).

Delete the `useEffect` that calls `toast` on success/error (lines around 92-99 — surface via modal instead).

Decide on the inline `extractError` Alert at line 222-227: the user's preference (Category 2 stays) means we keep this only if it represents *persistent guidance* (a non-transient state). Since `extractError` is a transient mutation error, it duplicates the modal — delete it. The "fees not yet extracted" Alert at line 212-220 (if it shows for `accumulatedFees === 0n` or similar guidance) stays.

Re-read lines 212-227 of the current file to confirm which is which before deleting:

Run: `sed -n '200,230p' packages/frontend/src/components/admin/TreasuryControls.jsx`

Then delete only the transient-error Alert block, keeping the guidance Alert.

Inside the returned JSX, before the closing wrapper tag, mount:

```jsx
      <TransactionModal mutation={extractStatus} title="Extracting Fees to Treasury" />
```

- [ ] **Step 10.3: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 10.4: Commit**

```bash
git add packages/frontend/src/hooks/useTreasury.js packages/frontend/src/components/admin/TreasuryControls.jsx
git commit -m "feat(frontend): TreasuryControls uses TransactionModal"
```

---

## Task 11 — Fix broken `@/hooks/use-toast` imports

**Files:**
- Modify: `packages/frontend/src/components/admin/GroupsPanel.jsx`
- Modify: `packages/frontend/src/components/admin/RouteAccessPanel.jsx`

Both files import from `@/hooks/use-toast` (hyphenated). The file on disk is `useToast.js` (camelCase). Neither component is mounted in the live app, so the build hasn't broken — but it would the moment anyone tries to use them.

- [ ] **Step 11.1: Fix GroupsPanel import**

Edit `packages/frontend/src/components/admin/GroupsPanel.jsx`:

Find at line 46:

```jsx
import { useToast } from "@/hooks/use-toast";
```

Replace with:

```jsx
import { useToast } from "@/hooks/useToast";
```

- [ ] **Step 11.2: Fix RouteAccessPanel import**

Edit `packages/frontend/src/components/admin/RouteAccessPanel.jsx`:

Find at line 46:

```jsx
import { useToast } from "@/hooks/use-toast";
```

Replace with:

```jsx
import { useToast } from "@/hooks/useToast";
```

- [ ] **Step 11.3: Lint check**

Run: `cd packages/frontend && npm run lint`
Expected: PASS.

- [ ] **Step 11.4: Commit**

```bash
git add packages/frontend/src/components/admin/GroupsPanel.jsx packages/frontend/src/components/admin/RouteAccessPanel.jsx
git commit -m "fix(frontend): broken @/hooks/use-toast import path in unmounted admin panels"
```

---

## Task 12 — Final verification + version bump + push

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 12.1: Bump version to 0.37.0 (minor — UX-level change across multiple flows)**

Edit `packages/frontend/package.json`. Change `"version": "0.36.1"` to `"version": "0.37.0"`.

- [ ] **Step 12.2: Full lint + test sweep**

Run: `npm run lint`
Expected: PASS across all packages.

Run: `npm test`
Expected: All packages green.

- [ ] **Step 12.3: Browser smoke test (manual)**

Start dev server: `npm run dev`

Walk through the following flows in the browser. For each, verify the modal opens, shows pending → confirmed (or error with full-error scroll), closes cleanly:

1. Curve buy success
2. Curve buy reverted (e.g. insufficient SOF approval — modal shows revert reason; expand "Full error" — it scrolls inside modal, doesn't push past viewport)
3. Curve sell with insufficient curve reserves (pre-flight throw → modal shows reason)
4. Mobile BuySellSheet buy + sell
5. InfoFi market placeBet
6. Claim raffle grand
7. Claim raffle consolation (with rollover)
8. Spend from rollover (via curve BuySellWidget)
9. Refund rollover (via RolloverPortfolioCard)
10. Sponsored ERC20 claim
11. Treasury extract fees (admin)
12. Admin: start / settle / finalize / create season (regression — they already used TransactionModal)

- [ ] **Step 12.4: Commit version bump**

```bash
git add packages/frontend/package.json
git commit -m "chore(frontend): bump to 0.37.0 for TransactionModal consolidation"
```

- [ ] **Step 12.5: Push to PR**

```bash
git push
```

Verify PR #86 picks up the commits and the preview env redeploys.

- [ ] **Step 12.6: Mark PR ready for review**

```bash
gh pr ready 86
```

---

## Self-Review

- **Spec coverage**: All 7 Category-1 callers covered (curve, mobile, InfoFi BuySell; InfoFi & raffle claims; sponsor; rollover; treasury). Modal scroll fix in Task 1. Shared util in Task 2. Broken imports in Task 11. ✅
- **Placeholder scan**: All code blocks contain real implementation. No "TBD" / "implement later". Step 4.2 references "concrete edits to make in useTransactionHandlers.js" with specifics rather than a placeholder — engineer must re-read the file first since the current contents shape the diff. ✅
- **Type consistency**: `useBuySellTransactions` returns `{buyMutation, sellMutation}` in Task 4 → consumed identically in Tasks 5-6. `useTransactionStatus(mutation)` signature defined in Task 3 → consumed identically in every later task. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-transaction-modal-consolidation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
