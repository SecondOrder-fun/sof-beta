# Completed Raffle Detail — Design

**Status:** Draft
**Date:** 2026-05-12
**Scope:** Frontend (`@sof/frontend`), desktop view of `routes/RaffleDetails.jsx`

## Goal

When a raffle season is in `Completed` state (on-chain status 4 or 5) or `Cancelled` (status 6), the desktop Raffle Detail page should present results-first content: Winner & Grand Prize, Consolation pool/share, Transactions, and Holders. Curve/token addresses move into a collapsed "Raffle info" accordion. The active-state UI (bonding curve graph, Buy/Sell widget, position card) is removed for completed seasons.

Mobile detail (`MobileRaffleDetail.jsx`) is **out of scope** for this spec.

## Layout (Option C — hero-with-split)

```
┌─ Page title: "Season #N — <name>"
├─ Time row: start · end · "Completed" badge
│
├─ Results card  (NEW component: CompletedRaffleResults)
│    ┌─ RESULTS label
│    ├─ ┌────────── Winner (hero, centered) ──────────┐
│    │  │   alice.eth                                  │
│    │  │   0xA1B2…c3f3                                │
│    │  └────────────────────────────────────────────┘
│    └─ ┌─ Grand Prize ──────┬─ Consolation ──────────┐
│       │ 1,250.00 SOF       │ 500 SOF · 2.50 each    │
│       │                    │ Badge: You: claimable  │
│       └────────────────────┴────────────────────────┘
│
├─ SponsoredPrizesDisplay      (existing, unchanged)
├─ ClaimPrizeWidget            (existing, unchanged; winner-only)
│
├─ 2-col grid
│    ├─ Card: Transactions    (existing TransactionsTab, unchanged props)
│    └─ Card: Holders         (existing HoldersTab,      unchanged props)
│
└─ Accordion: "Raffle info"  (collapsed by default)
     └─ TokenInfoTab          (existing, unchanged props)
```

## Where this branches in code

Inside `routes/RaffleDetails.jsx`, the existing render currently outputs the active-state UI unconditionally. After the time row and status hints, we branch on `isCompletedSeason` (already computed at line 68 as `statusNum === 4 || statusNum === 5`) and on a new `isCancelledSeason = statusNum === 6`. The completed branch returns the new layout above; the active branch keeps the current code unchanged.

No new route, no new top-level page.

## Components & files

### New (1)

#### `packages/frontend/src/components/raffle/CompletedRaffleResults.jsx`

Pure presentational. Composes existing primitives: `Card`, `CardContent`, `Badge`, `UsernameDisplay`. Uses `formatUnits` from viem.

Props:

```js
{
  winnerAddress: string | null,        // null → "Awaiting draw…" + VRF pending pill
  grandPrizeWei: bigint,               // 0n → "—"
  consolationStatus: {
    totalPoolWei: bigint,
    perLoserShareWei: bigint,          // 0n when pool=0 or loserCount=0
    viewerEligible: boolean | null,    // null → wallet disconnected
    viewerClaimed: boolean,
    isLoading: boolean,
  },
  seasonStatus: number,                // 4 | 5 | 6
}
```

Render variants (one per state):

| State | `seasonStatus` | Winner row | Consolation badge |
|-------|----------------|------------|-------------------|
| Happy path | 5 | UsernameDisplay + truncated address | `claimable` / `claimed` (Badge) |
| VRF pending | 4 | "Awaiting draw…" + amber `VRF pending` Badge | "claims open after draw" subline |
| Cancelled | 6 | Full-card override: "Season cancelled — no payout" | (no consolation row rendered) |
| Disconnected | 4/5 | normal | "connect wallet to check eligibility" subline |
| Pool = 0 | 4/5 | normal | "—" |

i18n keys (new, `raffle` namespace): `results`, `awaitingDraw`, `vrfPending`, `seasonCancelledNoPayout`, `consolationPerLoser` (e.g. `"{{total}} SOF · {{share}} each"`), `consolationClaimsOpenAfterDraw`, `connectToCheckEligibility`, `youClaimable`, `youClaimed`.

### New (2)

#### `packages/frontend/src/hooks/useConsolationStatus.js`

Combines existing `useRafflePrizes(seasonId)` with two new distributor reads (`isEligibleForConsolation`, `hasClaimedConsolation`). Returns the `consolationStatus` shape above.

```js
function useConsolationStatus(seasonId) {
  const { address } = useRaffleAccount();              // SMA-bound, like useRafflePrizes
  const prizes = useRafflePrizes(seasonId);
  const { distributorAddress } = prizes;
  const seasonPayouts = prizes._seasonPayouts;         // NOTE: expose this from useRafflePrizes
  // ↑ requires exposing seasonPayouts (currently internal) from useRafflePrizes

  const { data: eligible } = useReadContract({
    address: distributorAddress, abi: PrizeDistributorAbi,
    functionName: "isEligibleForConsolation",
    args: [BigInt(seasonId), address],
    query: { enabled: !!distributorAddress && !!address && !!seasonId },
  });

  const { data: claimed } = useReadContract({
    address: distributorAddress, abi: PrizeDistributorAbi,
    functionName: "hasClaimedConsolation",
    args: [BigInt(seasonId), address],
    query: { enabled: !!distributorAddress && !!address && !!seasonId },
  });

  const totalPoolWei = seasonPayouts?.consolationAmount ?? 0n;
  const totalParticipants = seasonPayouts?.totalParticipants ?? 0n;
  const loserCount = totalParticipants > 0n ? totalParticipants - 1n : 0n;
  const perLoserShareWei = loserCount > 0n ? totalPoolWei / loserCount : 0n;

  return {
    totalPoolWei,
    perLoserShareWei,
    viewerEligible: address ? Boolean(eligible) : null,
    viewerClaimed: Boolean(claimed),
    isLoading: prizes.isLoading,
  };
}
```

**Hook contract change:** `useRafflePrizes` must export `seasonPayouts` (today it consumes it internally and exposes only derived fields like `grandWinner`, `funded`). One-line addition to the return object. No call site changes for current callers.

### Existing components reused (zero modifications)

- `routes/RaffleDetails.jsx` — branch added; existing active-branch code untouched
- `components/ui/{card,badge,accordion}.jsx`
- `components/common/{SecondaryCard,ExplorerLink}.jsx`
- `components/user/UsernameDisplay.jsx`
- `components/prizes/SponsoredPrizesDisplay.jsx`
- `components/prizes/ClaimPrizeWidget.jsx`
- `components/curve/{TransactionsTab,HoldersTab,TokenInfoTab}.jsx`
- `components/layout/PageTitle.jsx`

## Data flow

```
RaffleDetails
  ├── useRaffleState(seasonId)                  → seasonDetailsQuery (status, config)
  ├── useSeasonWinnerSummary(seasonId, status)  → { winnerAddress, grandPrizeWei }
  └── (completed branch)
       └── CompletedRaffleResults
            └── useConsolationStatus(seasonId)
                 ├── useRafflePrizes(seasonId)  → seasonPayouts (incl. consolationAmount, totalParticipants)
                 ├── readContract isEligibleForConsolation
                 └── readContract hasClaimedConsolation
```

`useRaffleState`, `useSeasonWinnerSummary`, `useRafflePrizes` are already mounted in the active branch; no extra network cost. The two new distributor reads run only when on the completed branch.

## What gets removed from the completed branch

- `BondingCurvePanel` and its surrounding 2/3-col Card
- `BuySellWidget` and the 1/3-col Card
- The player-position `SecondaryCard`
- The inline toasts container (no trades → no toasts)
- The existing `Tabs`/`TabsList` wrapper (Token Info / Transactions / Holders) — replaced by 2-col grid + accordion
- The status hints "Window open on-chain, awaiting admin Start" / "Window ended on-chain, awaiting admin End" (status 0/1 only — already wouldn't render at 4/5/6 but worth confirming during implementation)

`RaffleAdminControls` and `TreasuryControls` continue to render below for admin views (unchanged).

## Edge cases

| Case | Behavior |
|------|----------|
| `status === 4`, winner not set | Winner row → "Awaiting draw…" with VRF pending Badge; Grand/Consolation still render from `getSeason` |
| `status === 6` (cancelled) | Replace Results card with full-card cancelled notice; hide Claim widget; keep Transactions/Holders |
| `consolationAmount === 0n` | Consolation cell shows "—" only; no per-loser share, no viewer status |
| Wallet disconnected | "You: …" line is suppressed; "connect wallet to check eligibility" subline shown |
| `distributorAddress` missing | Grand/Consolation cells show "Pending payout setup"; Winner row still renders if available |
| `totalParticipants === 0` (shouldn't happen post-settlement but guard) | `perLoserShareWei = 0n` |

## Testing

New unit tests in `components/raffle/__tests__/CompletedRaffleResults.test.jsx`:

1. Renders winner + grand prize + per-loser share with mock props (happy path)
2. Shows "Awaiting draw…" when `winnerAddress === null` and `seasonStatus === 4`
3. Shows cancelled notice when `seasonStatus === 6`
4. Suppresses viewer-status badge when `viewerEligible === null`
5. Shows "claimed" badge when `viewerClaimed === true`
6. Shows "—" for consolation when `totalPoolWei === 0n`

New unit tests in `hooks/__tests__/useConsolationStatus.test.js`:

1. Returns `perLoserShareWei = totalPoolWei / (totalParticipants - 1)` with mocked dependencies
2. `viewerEligible` is `null` when no wallet connected
3. `perLoserShareWei = 0n` when pool or loserCount is 0

No new E2E paths required — completed-state seasons are already exercised by the existing detail-page e2e seed (status 5 cohort).

## Version bump

`@sof/frontend` minor bump (new feature). Per CLAUDE.md, increment in `packages/frontend/package.json` only.

## Out of scope

- Mobile (`MobileRaffleDetail.jsx`) — separate follow-up
- Adding a "Claim consolation" call-to-action button (read-only display only in this spec; claim happens via existing `ClaimPrizeWidget` for grand and via existing distributor flows for consolation)
- New i18n locale translations beyond the 9 already configured — keys added to all 9 `raffle.json` files, but only English copy is authoritative for this PR
- Animations on accordion expand (uses existing Radix accordion defaults)
