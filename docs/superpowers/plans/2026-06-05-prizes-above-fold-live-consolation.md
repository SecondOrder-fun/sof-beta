# Prizes Above the Fold + Live Consolation Ticker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the combined Grand/Consolation prize card above the fold on the active Raffle Detail page, drive its participant count live via a new `ConsolationPoolUpdated` SSE event, and replace the buy/sell center-screen modal with a widget-scoped status overlay.

**Architecture:** Three independent units. (1) A pure `prizeMath` helper + presentational `PrizePoolCard` rendered in the active right column under Buy/Sell, fed live curve reserves (already live via `useCurveState`) and a live participant count from a focused `useLiveParticipantCount` hook. (2) Backend extends `positionUpdateListener` to broadcast `ConsolationPoolUpdated` on the existing `raffle` channel (participant count is already in scope as `participants.length`). (3) A `TransactionStatusOverlay` absolutely positioned over the `relative` `BuySellWidget`, replacing the two `TransactionModal` dialogs.

**Tech Stack:** React 18, Vitest + @testing-library/react, Tailwind (semantic CSS vars), react-i18next, Fastify SSE, viem.

**Spec:** `docs/superpowers/specs/2026-06-05-prizes-above-fold-live-consolation-design.md`

> **Note — deviation from spec:** The spec proposed extending `useConsolationStatus(seasonId, { isActive })`. During planning we found that hook sources the **RafflePrizeDistributor settlement snapshot** (empty during active seasons) and has 6 tests + a `CompletedRaffleResults` consumer. The live active-season count is cleaner as a new focused `useLiveParticipantCount` hook that reads `totalParticipants` straight off the SSE `lastEvent`, leaving `useConsolationStatus` (and AC#3's `staleTime: Infinity` claim reads) entirely untouched. Same outcome, smaller blast radius.

## File Structure

**Frontend (`packages/frontend`):**
- Create: `src/lib/prizeMath.js` — pure bps split + per-loser share (Task 1)
- Create: `src/lib/__tests__/prizeMath.test.js` (Task 1)
- Create: `src/hooks/useLiveParticipantCount.js` — live participant count via SSE (Task 2)
- Create: `src/hooks/__tests__/useLiveParticipantCount.test.js` (Task 2)
- Create: `src/components/prizes/PrizePoolCard.jsx` — combined prize card (Task 3)
- Create: `src/components/prizes/__tests__/PrizePoolCard.test.jsx` (Task 3)
- Modify: `src/components/curve/CurveGraph.jsx:246` — full-mode height 320→368 (Task 4)
- Modify: `src/routes/RaffleDetails.jsx` — render card, pass live count/reserves (Task 4)
- Modify: `src/components/curve/TokenInfoTab.jsx` — remove prize-distribution block + dead memos (Task 4)
- Modify: `public/locales/en/raffle.json` — new card strings (Task 4)
- Create: `src/components/buysell/TransactionStatusOverlay.jsx` (Task 5)
- Create: `src/components/buysell/__tests__/TransactionStatusOverlay.test.jsx` (Task 5)
- Modify: `src/components/curve/BuySellWidget.jsx` — swap modal→overlay (Task 6)
- Modify: `package.json` — minor version bump (Task 8)

**Backend (`packages/backend`):**
- Create: `src/listeners/buildConsolationPoolEvent.js` — pure payload builder (Task 7)
- Create: `src/listeners/__tests__/buildConsolationPoolEvent.test.js` (Task 7)
- Modify: `src/listeners/positionUpdateListener.js` — broadcast the event (Task 7)
- Modify: `package.json` — minor version bump (Task 8)

**Commands:** run single tests with `npx vitest run <path>` from the package dir. Full gates from repo root: `npm test`, `npm run lint`, `npm run build`.

---

### Task 1: `prizeMath` helper

**Files:**
- Create: `packages/frontend/src/lib/prizeMath.js`
- Test: `packages/frontend/src/lib/__tests__/prizeMath.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/frontend/src/lib/__tests__/prizeMath.test.js
import { describe, it, expect } from "vitest";
import { splitPrizePool, perLoserShareWei, GRAND_PRIZE_BPS } from "@/lib/prizeMath";

describe("splitPrizePool", () => {
  it("splits 65/35 by bps", () => {
    const { grandWei, consolationWei } = splitPrizePool(1000n);
    expect(grandWei).toBe(650n);
    expect(consolationWei).toBe(350n);
    expect(GRAND_PRIZE_BPS).toBe(6500n);
  });
  it("returns zeros for 0 reserves", () => {
    expect(splitPrizePool(0n)).toEqual({ grandWei: 0n, consolationWei: 0n });
  });
  it("coerces nullish/garbage reserves to zero", () => {
    expect(splitPrizePool(undefined)).toEqual({ grandWei: 0n, consolationWei: 0n });
    expect(splitPrizePool("not-a-bigint")).toEqual({ grandWei: 0n, consolationWei: 0n });
  });
});

describe("perLoserShareWei", () => {
  it("divides consolation across losers (participants - 1)", () => {
    expect(perLoserShareWei(350n, 8)).toBe(50n); // 350 / 7
  });
  it("returns 0 with <= 1 participant", () => {
    expect(perLoserShareWei(350n, 1)).toBe(0n);
    expect(perLoserShareWei(350n, 0)).toBe(0n);
  });
  it("returns 0 with empty consolation", () => {
    expect(perLoserShareWei(0n, 5)).toBe(0n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/__tests__/prizeMath.test.js`
Expected: FAIL — cannot resolve `@/lib/prizeMath`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/frontend/src/lib/prizeMath.js
// Grand-prize share in basis points. Contract default is 6500 (65%); the
// remaining 35% funds the consolation pool. Kept here as the single source
// of truth for prize-split math shared by PrizePoolCard and any future
// consumer (replaces the inline 6500n literal formerly in TokenInfoTab).
export const GRAND_PRIZE_BPS = 6500n;

function toBigIntOrZero(v) {
  try {
    return BigInt(v ?? 0n);
  } catch {
    return 0n;
  }
}

export function splitPrizePool(reservesWei) {
  const reserves = toBigIntOrZero(reservesWei);
  const grandWei = (reserves * GRAND_PRIZE_BPS) / 10000n;
  return { grandWei, consolationWei: reserves - grandWei };
}

export function perLoserShareWei(consolationWei, totalParticipants) {
  const consolation = toBigIntOrZero(consolationWei);
  const participants = toBigIntOrZero(totalParticipants);
  const losers = participants > 1n ? participants - 1n : 0n;
  return consolation > 0n && losers > 0n ? consolation / losers : 0n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/__tests__/prizeMath.test.js`
Expected: PASS (3 + 3 assertions green).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/prizeMath.js packages/frontend/src/lib/__tests__/prizeMath.test.js
git commit -m "feat(frontend): add prizeMath helper for grand/consolation split (#106)"
```

---

### Task 2: `useLiveParticipantCount` hook

Surfaces the latest `totalParticipants` from the `raffle` channel `ConsolationPoolUpdated` events, falling back to an initial count before the first event lands.

**Files:**
- Create: `packages/frontend/src/hooks/useLiveParticipantCount.js`
- Test: `packages/frontend/src/hooks/__tests__/useLiveParticipantCount.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/frontend/src/hooks/__tests__/useLiveParticipantCount.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useLiveSubscriptionMock = vi.fn();
vi.mock("@/hooks/chain/useLiveSubscription", () => ({
  useLiveSubscription: (args) => useLiveSubscriptionMock(args),
}));

import { useLiveParticipantCount } from "@/hooks/useLiveParticipantCount";

describe("useLiveParticipantCount", () => {
  beforeEach(() => useLiveSubscriptionMock.mockReset());

  it("falls back to initialCount before any event", () => {
    useLiveSubscriptionMock.mockReturnValue({ status: "open", lastEvent: null });
    const { result } = renderHook(() =>
      useLiveParticipantCount(7, { enabled: true, initialCount: 3 }),
    );
    expect(result.current).toBe(3);
  });

  it("returns the live totalParticipants from a matching event", () => {
    useLiveSubscriptionMock.mockReturnValue({
      status: "open",
      lastEvent: { type: "ConsolationPoolUpdated", seasonId: 7, totalParticipants: 12 },
    });
    const { result } = renderHook(() =>
      useLiveParticipantCount(7, { enabled: true, initialCount: 3 }),
    );
    expect(result.current).toBe(12);
  });

  it("subscribes to the raffle channel and is disabled when seasonId is null", () => {
    useLiveSubscriptionMock.mockReturnValue({ status: "connecting", lastEvent: null });
    renderHook(() => useLiveParticipantCount(null, { enabled: true, initialCount: 0 }));
    const arg = useLiveSubscriptionMock.mock.calls[0][0];
    expect(arg.channel).toBe("raffle");
    expect(arg.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useLiveParticipantCount.test.js`
Expected: FAIL — cannot resolve `@/hooks/useLiveParticipantCount`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/frontend/src/hooks/useLiveParticipantCount.js
import { useMemo } from "react";
import { useLiveSubscription } from "@/hooks/chain/useLiveSubscription";

/**
 * Live unique-participant count for an active season. Reads the latest
 * `totalParticipants` straight off the `raffle`-channel `ConsolationPoolUpdated`
 * event (emitted by the backend on every PositionUpdate while Active), falling
 * back to `initialCount` until the first event arrives.
 *
 * @param {number|string|null} seasonId
 * @param {{ enabled?: boolean, initialCount?: number }} [opts]
 * @returns {number}
 */
export function useLiveParticipantCount(seasonId, { enabled = true, initialCount = 0 } = {}) {
  const { lastEvent } = useLiveSubscription({
    channel: "raffle",
    enabled: enabled && seasonId != null,
    filter: (e) =>
      e?.type === "ConsolationPoolUpdated" &&
      Number(e?.seasonId) === Number(seasonId),
  });

  return useMemo(() => {
    const live = lastEvent?.totalParticipants;
    const liveNum = Number(live);
    if (live != null && Number.isFinite(liveNum)) return liveNum;
    return Number(initialCount) || 0;
  }, [lastEvent, initialCount]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useLiveParticipantCount.test.js`
Expected: PASS (3 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useLiveParticipantCount.js packages/frontend/src/hooks/__tests__/useLiveParticipantCount.test.js
git commit -m "feat(frontend): add useLiveParticipantCount SSE hook (#106)"
```

---

### Task 3: `PrizePoolCard` component

Presentational. Takes live reserves + participant count as props (no data fetching inside) so it's trivially testable; the live wiring happens in Task 4.

**Files:**
- Create: `packages/frontend/src/components/prizes/PrizePoolCard.jsx`
- Test: `packages/frontend/src/components/prizes/__tests__/PrizePoolCard.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// packages/frontend/src/components/prizes/__tests__/PrizePoolCard.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
}));
vi.mock("@/hooks/useSofDecimals", () => ({ useSofDecimals: () => 18 }));

import PrizePoolCard from "@/components/prizes/PrizePoolCard";

const ONE = 10n ** 18n;

describe("PrizePoolCard", () => {
  it("renders grand (65%) and consolation (35%) from reserves", () => {
    // 1000 SOF reserves → grand 650, consolation 350
    render(<PrizePoolCard curveReservesWei={1000n * ONE} totalParticipants={8} />);
    expect(screen.getByText(/650/)).toBeInTheDocument();
    expect(screen.getByText(/350/)).toBeInTheDocument();
  });

  it("renders the live participant count", () => {
    render(<PrizePoolCard curveReservesWei={1000n * ONE} totalParticipants={142} />);
    expect(screen.getByText("142")).toBeInTheDocument();
  });

  it("renders per-player share (consolation / (participants-1))", () => {
    // 350 / 7 = 50 SOF each
    render(<PrizePoolCard curveReservesWei={1000n * ONE} totalParticipants={8} />);
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/components/prizes/__tests__/PrizePoolCard.test.jsx`
Expected: FAIL — cannot resolve `@/components/prizes/PrizePoolCard`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// packages/frontend/src/components/prizes/PrizePoolCard.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormatSOF } from "@/hooks/buysell/useFormatSOF";
import { useSofDecimals } from "@/hooks/useSofDecimals";
import { splitPrizePool, perLoserShareWei } from "@/lib/prizeMath";

/**
 * Combined Grand + Consolation prize card for the active right column.
 * Pure/presentational: reserves and participant count are supplied by the
 * parent (RaffleDetails), which sources them live (curve reserves via
 * useCurveState, participant count via useLiveParticipantCount).
 */
const PrizePoolCard = ({ curveReservesWei, totalParticipants }) => {
  const { t } = useTranslation("raffle");
  const decimals = useSofDecimals();
  const formatSOF = useFormatSOF(typeof decimals === "number" ? decimals : 18);

  const { grandWei, consolationWei } = splitPrizePool(curveReservesWei);
  const shareWei = perLoserShareWei(consolationWei, totalParticipants);
  const participants = Number(totalParticipants) || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t("prizePool", { defaultValue: "Prize Pool" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-medium">
              🏆 {t("grandPrize", { defaultValue: "Grand Prize" })}
            </span>
            <span className="text-xs text-muted-foreground">65%</span>
          </div>
          <div className="font-mono text-lg font-bold">{formatSOF(grandWei)} SOF</div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">
              🎁 {t("consolationPool", { defaultValue: "Consolation Pool" })}
            </span>
            <span className="text-xs text-muted-foreground">35%</span>
          </div>
          <div className="font-mono text-lg font-bold">{formatSOF(consolationWei)} SOF</div>

          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("perPlayerShare", { defaultValue: "Per-player share" })}
            </span>
            <span className="font-mono">{formatSOF(shareWei)} SOF</span>
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("players", { defaultValue: "Players" })}
            </span>
            <span className="font-mono">{participants}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

PrizePoolCard.propTypes = {
  curveReservesWei: PropTypes.oneOfType([PropTypes.string, PropTypes.bigint]),
  totalParticipants: PropTypes.oneOfType([PropTypes.number, PropTypes.string, PropTypes.bigint]),
};

export default PrizePoolCard;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/components/prizes/__tests__/PrizePoolCard.test.jsx`
Expected: PASS (3 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/prizes/PrizePoolCard.jsx packages/frontend/src/components/prizes/__tests__/PrizePoolCard.test.jsx
git commit -m "feat(frontend): add combined PrizePoolCard (#106)"
```

---

### Task 4: Promote the card into RaffleDetails (+ taller curve, TokenInfoTab cleanup, i18n)

Integration task — no new unit test; verified by the full frontend suite (the existing `RaffleDetails.completedBranch.test.jsx` must still pass) plus manual smoke.

**Files:**
- Modify: `packages/frontend/src/components/curve/CurveGraph.jsx:246`
- Modify: `packages/frontend/src/routes/RaffleDetails.jsx`
- Modify: `packages/frontend/src/components/curve/TokenInfoTab.jsx`
- Modify: `packages/frontend/public/locales/en/raffle.json`

- [ ] **Step 1: Scale the bonding curve up ~15%**

In `packages/frontend/src/components/curve/CurveGraph.jsx` line 246, change the full-mode height:

```js
// before
const chartHeight = mini ? "100%" : compact ? 200 : 320;
// after
const chartHeight = mini ? "100%" : compact ? 200 : 368;
```

- [ ] **Step 2: Add i18n keys**

In `packages/frontend/public/locales/en/raffle.json`, add these keys (alongside the existing `grandPrize`/`participants` keys). `prizePool` and `grandPrize` already exist — only add the missing three:

```json
  "consolationPool": "Consolation Pool",
  "perPlayerShare": "Per-player share",
  "players": "Players",
```

- [ ] **Step 3: Render `PrizePoolCard` in the active right column**

In `packages/frontend/src/routes/RaffleDetails.jsx`:

Add imports near the other component imports (after the `BuySellWidget` import, line ~19):

```jsx
import PrizePoolCard from "@/components/prizes/PrizePoolCard";
import { useLiveParticipantCount } from "@/hooks/useLiveParticipantCount";
```

After the `useCurveState(...)` destructure (ends line ~131), add the live participant count (initial value comes from the season-details warm read already loaded in this component):

```jsx
  const liveParticipantCount = useLiveParticipantCount(seasonIdNumber, {
    enabled: isActiveSeason,
    initialCount: Number(seasonDetailsQuery?.data?.totalParticipants ?? 0),
  });
```

Then, inside the active (non-completed) branch, in the right-column `<Card>` that holds `BuySellWidget` (the `<Card>` opening at line ~642), render the prize card immediately AFTER the closing `</Card>` of that right column (i.e. as a second item stacked in the right column). Because the right column is a single grid cell, wrap the two cards in a vertical stack. Replace the single right-column `<Card>...</Card>` (lines ~642-707) with:

```jsx
                    <div className="space-y-4">
                      <Card>
                        <CardContent>
                          {chainNow && (
                            <BuySellWidget
                              bondingCurveAddress={bc}
                              seasonId={seasonIdNumber}
                              initialTab={initialTradeTab}
                              isGated={isSeasonGated}
                              isVerified={isGatingVerified}
                              onGatingRequired={handleGatingRequired}
                              onTxSuccess={triggerStaggeredRefresh}
                            />
                          )}
                          {/* Player position display - only visible when a wallet is connected */}
                          {isConnected && (
                            <SecondaryCard
                              title={t("yourCurrentPosition")}
                              right={
                                isRefreshing ? (
                                  <Badge variant="outline" className="animate-pulse">
                                    {t("updating")}
                                  </Badge>
                                ) : null
                              }
                            >
                              {localPosition ? (
                                <div className="space-y-1">
                                  <div>
                                    <span className="text-primary">{t("tickets")}:</span>{" "}
                                    <span className="font-mono">
                                      {localPosition.tickets.toString()}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-primary">{t("winProbability")}:</span>{" "}
                                    <span className="font-mono">
                                      {(() => {
                                        try {
                                          const bps = Number(localPosition.probBps);
                                          return `${(bps / 100).toFixed(2)}%`;
                                        } catch {
                                          return "0.00%";
                                        }
                                      })()}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {t("totalTicketsAtSnapshot")}:{" "}
                                    <span className="font-mono">
                                      {localPosition.total.toString()}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">No position yet.</span>
                              )}
                            </SecondaryCard>
                          )}
                        </CardContent>
                      </Card>
                      <PrizePoolCard
                        curveReservesWei={curveReserves ?? 0n}
                        totalParticipants={liveParticipantCount}
                      />
                    </div>
```

> Implementer note: this preserves the exact existing BuySellWidget/position markup — only the wrapping `<div className="space-y-4">` and the trailing `<PrizePoolCard>` are new. Keep the surrounding `grid grid-cols-1 lg:grid-cols-3` row (the Bonding Curve `lg:col-span-2` card is unchanged).

- [ ] **Step 4: Remove the now-duplicated prize block from `TokenInfoTab`**

In `packages/frontend/src/components/curve/TokenInfoTab.jsx`:

1. Delete the `grandPrize` memo (lines ~113-121) and the `consolationPerUser` memo (lines ~123-135) — they're now dead.
2. Delete the comment block at lines ~111-112.
3. Replace the two-column grid (lines ~145-253) so only the LEFT column (addresses + supply) remains, full width. Concretely, remove the entire `{/* RIGHT COLUMN */}` `<div>` (lines ~212-252) and change the wrapper `<div className="grid grid-cols-1 md:grid-cols-2 gap-4">` (line 145) to `<div>` (single column). The left column's inner `<div className="space-y-4">` stays.
4. Remove `displayedPrizePool` (lines ~138-140) — now unused.
5. Keep `isSeasonActive` only if still referenced elsewhere in the file; if `grep` shows no other use after the deletions, remove it too. Remove the now-unused `formatSOF` import/call only if no other usage remains (verify with grep — `currentPrice`/supply rendering may still use it; if so, keep).

Verification grep after editing:

```bash
cd packages/frontend && grep -n "grandPrize\|consolationPerUser\|displayedPrizePool\|prizePoolDistribution\|totalPrizePool" src/components/curve/TokenInfoTab.jsx
```

Expected: no remaining references to `grandPrize`, `consolationPerUser`, or `displayedPrizePool`. (`totalParticipants`/`totalPrizePool` props may remain declared in propTypes; leave them — they're harmless and other call sites pass them.)

- [ ] **Step 5: Run the full frontend suite + lint**

Run: `cd packages/frontend && npx vitest run && npm run lint`
Expected: PASS, zero lint warnings. If `TokenInfoTab` has unused-var lint errors, remove the corresponding dead imports/vars flagged.

- [ ] **Step 6: Manual smoke (verify completed view loses nothing)**

Per spec, completed seasons surface prize/winner via `CompletedRaffleResults`, not `TokenInfoTab`. Confirm by reading `src/components/raffle/CompletedRaffleResults.jsx` that grand prize + consolation are still rendered there. No code change expected; this is a read-only confirmation that the `TokenInfoTab` deletion doesn't strand the completed view.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/routes/RaffleDetails.jsx packages/frontend/src/components/curve/TokenInfoTab.jsx packages/frontend/src/components/curve/CurveGraph.jsx packages/frontend/public/locales/en/raffle.json
git commit -m "feat(frontend): promote PrizePoolCard above the fold, scale curve, drop dup prize block (#106)"
```

---

### Task 5: `TransactionStatusOverlay` component

Widget-scoped overlay driven by a `useTransactionStatus` result `{ isPending, isConfirming, isConfirmed, isError, hash, error, receipt }`. Success auto-decays after 4 s; error persists until dismissed; blocks pointer events while visible.

**Files:**
- Create: `packages/frontend/src/components/buysell/TransactionStatusOverlay.jsx`
- Test: `packages/frontend/src/components/buysell/__tests__/TransactionStatusOverlay.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// packages/frontend/src/components/buysell/__tests__/TransactionStatusOverlay.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "local" }));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ explorer: "https://explorer.test" }),
}));
vi.mock("@/lib/contractErrors", () => ({
  extractErrorDetails: () => ({ headline: "Failed", reason: "Slippage exceeded", fullMessage: "" }),
}));

import TransactionStatusOverlay from "@/components/buysell/TransactionStatusOverlay";

const idle = { isPending: false, isConfirming: false, isConfirmed: false, isError: false, hash: null, error: null, receipt: null };

describe("TransactionStatusOverlay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders nothing when idle", () => {
    const { container } = render(<TransactionStatusOverlay status={idle} title="Buying tickets" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows pending state", () => {
    render(<TransactionStatusOverlay status={{ ...idle, isPending: true }} title="Buying tickets" />);
    expect(screen.getByText("Buying tickets")).toBeInTheDocument();
    expect(screen.getByText(/Confirm in wallet/)).toBeInTheDocument();
  });

  it("shows success with explorer link and auto-decays after 4s", () => {
    const status = { ...idle, isConfirmed: true, hash: "0xabc", receipt: { status: "success" } };
    render(<TransactionStatusOverlay status={status} title="Tickets purchased" />);
    expect(screen.getByText("Tickets purchased")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://explorer.test/tx/0xabc");
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("Tickets purchased")).not.toBeInTheDocument();
  });

  it("shows error and does NOT auto-decay; dismisses on close", () => {
    const status = { ...idle, isError: true, error: new Error("x") };
    render(<TransactionStatusOverlay status={status} title="Buy failed" />);
    expect(screen.getByText(/Slippage exceeded/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText(/Slippage exceeded/)).toBeInTheDocument(); // still there
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText(/Slippage exceeded/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/components/buysell/__tests__/TransactionStatusOverlay.test.jsx`
Expected: FAIL — cannot resolve `@/components/buysell/TransactionStatusOverlay`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// packages/frontend/src/components/buysell/TransactionStatusOverlay.jsx
import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, CheckCircle2, XCircle, ExternalLink, X } from "lucide-react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { extractErrorDetails } from "@/lib/contractErrors";

const SUCCESS_DECAY_MS = 4000;

/**
 * Buy/Sell transaction status as an overlay covering the BuySellWidget
 * (the widget container is `relative`). Replaces the center-screen
 * TransactionModal for user-facing trades. Success auto-decays after 4s;
 * errors persist until dismissed. Blocks pointer events while visible.
 */
const TransactionStatusOverlay = ({ status, title }) => {
  const { t } = useTranslation(["transactions", "common"]);
  const [dismissed, setDismissed] = useState(false);

  const hash = typeof status?.hash === "string" ? status.hash : null;
  const receiptStatus = status?.receipt?.status;
  const isSuccess = Boolean(status?.isConfirmed && receiptStatus === "success");
  const isReverted = Boolean(status?.isConfirmed && receiptStatus && receiptStatus !== "success");
  const isError = Boolean(status?.isError) || isReverted;
  const isPending = Boolean((status?.isPending || status?.isConfirming) && !status?.isConfirmed && !status?.isError);
  const phase = isError ? "error" : isSuccess ? "success" : isPending ? "pending" : "idle";

  // New activity (new hash or a fresh pending) clears a prior dismissal.
  useEffect(() => {
    setDismissed(false);
  }, [hash, isPending]);

  // Auto-decay success only.
  useEffect(() => {
    if (phase !== "success") return undefined;
    const id = setTimeout(() => setDismissed(true), SUCCESS_DECAY_MS);
    return () => clearTimeout(id);
  }, [phase, hash]);

  if (phase === "idle" || dismissed) return null;

  const netCfg = getNetworkByKey(getStoredNetworkKey());
  const explorerUrl =
    netCfg?.explorer && hash ? `${netCfg.explorer.replace(/\/$/, "")}/tx/${hash}` : "";
  const errorDetails = isError ? extractErrorDetails(status?.error) : null;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-md bg-background/90 px-4 text-center backdrop-blur-sm"
      role="status"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
        aria-label={t("common:close", { defaultValue: "Close" })}
      >
        <X className="h-4 w-4" />
      </button>

      {phase === "pending" && (
        <>
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            {t("transactions:confirmInWallet", { defaultValue: "Confirm in wallet" })}
          </div>
        </>
      )}

      {phase === "success" && (
        <>
          <CheckCircle2 className="h-8 w-8 text-green-600" />
          <div className="font-medium">{title}</div>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline"
            >
              {t("common:viewOnExplorer", { defaultValue: "View on explorer" })}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}

      {phase === "error" && (
        <>
          <XCircle className="h-8 w-8 text-destructive" />
          <div className="font-medium">{title}</div>
          <div className="max-w-[260px] text-xs text-muted-foreground">
            {errorDetails?.reason ||
              errorDetails?.headline ||
              t("transactions:txFailed", { defaultValue: "Transaction failed" })}
          </div>
        </>
      )}
    </div>
  );
};

TransactionStatusOverlay.propTypes = {
  status: PropTypes.shape({
    isPending: PropTypes.bool,
    isConfirming: PropTypes.bool,
    isConfirmed: PropTypes.bool,
    isError: PropTypes.bool,
    hash: PropTypes.string,
    error: PropTypes.any,
    receipt: PropTypes.any,
  }),
  title: PropTypes.string.isRequired,
};

export default TransactionStatusOverlay;
```

> Implementer note: the `z-20 absolute inset-0` overlay covers the widget and intercepts clicks (blocking interaction) while visible, satisfying the no-click-through requirement. The decay-countdown bar from the mockup is deferred visual polish — not required for this pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/components/buysell/__tests__/TransactionStatusOverlay.test.jsx`
Expected: PASS (4 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/buysell/TransactionStatusOverlay.jsx packages/frontend/src/components/buysell/__tests__/TransactionStatusOverlay.test.jsx
git commit -m "feat(frontend): add TransactionStatusOverlay for buy/sell (#106)"
```

---

### Task 6: Swap the modal for the overlay in `BuySellWidget`

**Files:**
- Modify: `packages/frontend/src/components/curve/BuySellWidget.jsx`

- [ ] **Step 1: Replace import and usage**

In `packages/frontend/src/components/curve/BuySellWidget.jsx`:

1. Remove the import on line 32: `import TransactionModal from "@/components/admin/TransactionModal";`
2. Add: `import TransactionStatusOverlay from "@/components/buysell/TransactionStatusOverlay";`
3. Replace the two `<TransactionModal>` blocks (lines ~491-498) with a single overlay that reflects whichever trade is active. The outermost container is already `className="space-y-4 relative"` (line 317), so the overlay anchors to it. Replace:

```jsx
      <TransactionModal
        mutation={buyStatus}
        title={t("transactions:buyingTickets", { defaultValue: "Buying tickets" })}
      />
      <TransactionModal
        mutation={sellStatus}
        title={t("transactions:sellingTickets", { defaultValue: "Selling tickets" })}
      />
```

with:

```jsx
      {(() => {
        // Only one trade is ever in-flight; pick whichever status is active.
        const buyActive =
          buyStatus.isPending || buyStatus.isConfirming || buyStatus.isConfirmed || buyStatus.isError;
        const activeStatus = buyActive ? buyStatus : sellStatus;
        const title = buyActive
          ? t("transactions:buyingTickets", { defaultValue: "Buying tickets" })
          : t("transactions:sellingTickets", { defaultValue: "Selling tickets" });
        return <TransactionStatusOverlay status={activeStatus} title={title} />;
      })()}
```

- [ ] **Step 2: Run the buy/sell-adjacent tests + lint**

Run: `cd packages/frontend && npx vitest run src/components/curve src/components/buysell && npm run lint`
Expected: PASS, zero warnings. (`TransactionModal` remains imported by admin components — confirm with `grep -rn "TransactionModal" src/components/admin` that it's still used there; do not delete the file.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/curve/BuySellWidget.jsx
git commit -m "feat(frontend): replace buy/sell modal with widget-scoped overlay (#106)"
```

---

### Task 7: Backend `ConsolationPoolUpdated` SSE broadcast

Extract the payload into a pure, testable builder, then emit it from `positionUpdateListener` right after the existing `PositionUpdate` broadcast. `participants.length` (already in scope from the `getParticipants` read at line ~353) is the live count.

**Files:**
- Create: `packages/backend/src/listeners/buildConsolationPoolEvent.js`
- Test: `packages/backend/src/listeners/__tests__/buildConsolationPoolEvent.test.js`
- Modify: `packages/backend/src/listeners/positionUpdateListener.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/backend/src/listeners/__tests__/buildConsolationPoolEvent.test.js
import { describe, it, expect } from "vitest";
import { buildConsolationPoolEvent } from "../buildConsolationPoolEvent.js";

describe("buildConsolationPoolEvent", () => {
  it("builds the ConsolationPoolUpdated payload with stringified wei", () => {
    const evt = buildConsolationPoolEvent({
      seasonId: 7,
      participantCount: 142,
      reservesWei: 1000n,
      blockNumber: 18765432,
      txHash: "0xdeadbeef",
    });
    expect(evt).toEqual({
      type: "ConsolationPoolUpdated",
      seasonId: 7,
      totalParticipants: 142,
      totalPoolWei: "1000",
      blockNumber: 18765432,
      txHash: "0xdeadbeef",
    });
  });

  it("coerces missing reserves to '0' and missing count to 0", () => {
    const evt = buildConsolationPoolEvent({
      seasonId: 3,
      participantCount: undefined,
      reservesWei: undefined,
      blockNumber: 1,
      txHash: "0x1",
    });
    expect(evt.totalPoolWei).toBe("0");
    expect(evt.totalParticipants).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run src/listeners/__tests__/buildConsolationPoolEvent.test.js`
Expected: FAIL — cannot find `../buildConsolationPoolEvent.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/backend/src/listeners/buildConsolationPoolEvent.js
/**
 * Build the `ConsolationPoolUpdated` SSE payload broadcast on the `raffle`
 * channel on every PositionUpdate while a season is Active (issue #106).
 * The frontend derives Grand/Consolation amounts from live curve reserves;
 * this event's primary job is delivering the live `totalParticipants` count.
 *
 * @param {{ seasonId: number, participantCount: number|undefined,
 *           reservesWei: bigint|string|undefined, blockNumber: number,
 *           txHash: string }} args
 */
export function buildConsolationPoolEvent({
  seasonId,
  participantCount,
  reservesWei,
  blockNumber,
  txHash,
}) {
  let poolWei = "0";
  try {
    poolWei = BigInt(reservesWei ?? 0n).toString();
  } catch {
    poolWei = "0";
  }
  return {
    type: "ConsolationPoolUpdated",
    seasonId,
    totalParticipants: Number(participantCount) || 0,
    totalPoolWei: poolWei,
    blockNumber,
    txHash,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && npx vitest run src/listeners/__tests__/buildConsolationPoolEvent.test.js`
Expected: PASS (2 tests green).

- [ ] **Step 5: Wire the builder into the listener**

In `packages/backend/src/listeners/positionUpdateListener.js`:

1. Add the import at the top with the other listener imports (after line ~13):

```js
import { buildConsolationPoolEvent } from "./buildConsolationPoolEvent.js";
```

2. Hoist a reserves variable so it's visible at the broadcast site. Immediately BEFORE the `// Update curve_state with step/config/fees via multicall` try block (line ~694), add:

```js
          let curveReservesWei = 0n;
```

3. Inside that try block, where `cfg` is read, capture reserves. After the line `const cfg = results[1]?.status === 'success' ? results[1].result : null;` (line ~706), add:

```js
            curveReservesWei = cfg ? BigInt(cfg[1]) : 0n;
```

4. Immediately AFTER the existing `sseService.broadcast('raffle', { type: 'PositionUpdate', ... });` block (ends line ~730), add the consolation broadcast. `participants` is in scope from the read at line ~353 (and the handler already returned early at line ~362 if it was empty, so length ≥ 1 here). PositionUpdate events only fire during active trading, so this is inherently Active-gated:

```js
          // Live consolation-pool ticker (#106): participant count + pool on
          // every PositionUpdate while the season is Active. PositionUpdate only
          // fires during active trading, so no explicit status read is needed.
          sseService.broadcast(
            'raffle',
            buildConsolationPoolEvent({
              seasonId: seasonIdNum,
              participantCount: participants.length,
              reservesWei: curveReservesWei,
              blockNumber: Number(log.blockNumber),
              txHash: log.transactionHash,
            }),
          );
```

- [ ] **Step 6: Run backend tests + lint**

Run: `cd packages/backend && npx vitest run src/listeners && npm run lint`
Expected: PASS, zero warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/listeners/buildConsolationPoolEvent.js packages/backend/src/listeners/__tests__/buildConsolationPoolEvent.test.js packages/backend/src/listeners/positionUpdateListener.js
git commit -m "feat(backend): broadcast ConsolationPoolUpdated on PositionUpdate (#106)"
```

---

### Task 8: Version bumps + full verification

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Bump versions (minor — new feature)**

Check current versions and bump the minor for each:

```bash
node -p "require('./packages/frontend/package.json').version"
node -p "require('./packages/backend/package.json').version"
```

Edit `packages/frontend/package.json` and `packages/backend/package.json`, incrementing the minor version (e.g. `0.43.x` → `0.44.0`, `0.31.x` → `0.32.0`). Use the actual current values from the command above.

- [ ] **Step 2: Full monorepo gates**

Run from repo root:

```bash
npm test
npm run lint
npm run build
```

Expected: all packages pass tests, zero lint warnings, clean build. Fix any failures before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/package.json packages/backend/package.json
git commit -m "chore: bump frontend+backend minor for prizes-above-fold + live consolation (#106)"
```

- [ ] **Step 4: Push + open PR** (follow `github-pr-workflow` Phase 2)

```bash
git push -u origin feat/prizes-above-fold-live-consolation-106
gh pr create --title "Prizes above the fold + live consolation ticker (#106)" --body "$(cat <<'EOF'
Closes #106.

## Summary
- Promote a combined Grand/Consolation `PrizePoolCard` above the fold (active right column, under Buy/Sell); scale the bonding curve ~15% taller.
- Backend emits `ConsolationPoolUpdated` on the `raffle` SSE channel each PositionUpdate while Active; frontend `useLiveParticipantCount` drives a live player count.
- Replace the buy/sell center-screen `TransactionModal` with a widget-scoped `TransactionStatusOverlay` (4s success auto-decay, error persists until dismissed, blocks click-through).
- Remove the now-duplicated prize-distribution block from `TokenInfoTab`.

## Test plan
- [ ] `npm test` / `npm run lint` / `npm run build` green
- [ ] Active season: prize card shows Grand/Consolation/per-player/players; player count ticks on a buy (preview)
- [ ] Buy → overlay covers widget (pending→success, auto-hides ~4s); failed tx overlay persists until ✕
- [ ] Completed season: winner + consolation still render via CompletedRaffleResults
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Unit 1 (layout move) → Tasks 3, 4 ✓ (card, RaffleDetails wiring, TokenInfoTab cleanup, curve height)
- Unit 2 (live ticker: backend SSE + frontend hook) → Tasks 2, 7 ✓ (AC#1 raffle-channel event, AC#2 live participant via SSE, AC#3 claim reads untouched since `useConsolationStatus` is unchanged)
- Unit 3 (transaction overlay) → Tasks 5, 6 ✓ (4s decay, error persist, click-block, explorer link, error extraction)
- Shared math helper → Task 1 ✓
- Versioning → Task 8 ✓; i18n → Task 4 Step 2 ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type/name consistency:** `splitPrizePool`/`perLoserShareWei`/`GRAND_PRIZE_BPS` (Task 1) used identically in Task 3. `useLiveParticipantCount(seasonId, { enabled, initialCount })` defined Task 2, called identically Task 4. `buildConsolationPoolEvent({ seasonId, participantCount, reservesWei, blockNumber, txHash })` defined Task 7 Step 3, called identically Step 5. Status shape `{ isPending, isConfirming, isConfirmed, isError, hash, error, receipt }` consistent across Tasks 5–6. ✓

**Deviation from spec recorded:** `useConsolationStatus` left untouched in favor of `useLiveParticipantCount` (rationale in header note); AC#3 is satisfied trivially since the hook is unchanged.
