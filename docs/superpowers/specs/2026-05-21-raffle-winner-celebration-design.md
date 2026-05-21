# Raffle Winner Celebration — Design

**Status:** approved, ready for implementation plan
**Date:** 2026-05-21
**Scope:** frontend only (`packages/frontend`); new npm dep (`canvas-confetti`)
**Out of scope:** any backend, contract, or schema changes

## Problem

When a raffle season completes (or cancels), the result currently appears in the Raffle List's Complete tab and on the Raffle Detail page as a static `CompletedRaffleResults` card. The result reveal is anticlimactic for a feature whose entire premise is "you might win." There is no moment that marks the transition from "drawing in progress" to "we have a winner."

We want a one-time celebration screen on the user's first visit to a completed Raffle Detail page — ticket pulled from a box, confetti, spinning rays around the winner's name and SOF amount (plus sponsored prize if present). Until that user has personally seen the celebration, the raffle should appear in their Raffle List **Settling** tab rather than **Complete**, preserving the mystery. This is a viewer-side overlay only; on-chain status is unchanged.

## Goals / Non-goals

**In scope (this PR):**
- New `WinnerCelebrationModal` mounted by `RaffleDetails` on first view of a completed or cancelled season for the current viewer
- New generic `useFirstViewGate(scope, itemKey)` hook (per-viewer localStorage, cross-tab `storage` event sync)
- Raffle List bucket override: completed/cancelled seasons demote from `complete` to `settling` for viewers who have not yet seen the celebration
- Three modal variants: `celebrate` (default), `win` (viewer is the winner — adds "You won!" headline + inline `ClaimPrizeWidget`), `cancelled` (no confetti, shrinking ticket, refund copy)
- `canvas-confetti` dep + inline SVG artwork (box, ticket, rays)
- `prefers-reduced-motion` honored
- New i18n keys under `raffle.celebration.*`
- Vitest coverage for the hook, modal, and the two route call-sites
- Minor version bump in `packages/frontend/package.json` (new feature)

**Out of scope:**
- Server-side persistence of seen-state — localStorage is sufficient for v1
- Replay / "show me again" entry point
- Per-tier winner celebrations (only top winner is celebrated; sponsored prizes are surfaced as an addon line)
- Variant analytics / experimentation framework
- Customising the modal per chain/network

## Architecture overview

```
useFirstViewGate('celebrated', seasonId)
  ├─ viewer = useAccount().address?.toLowerCase() ?? 'anon'
  ├─ storageKey = `sof:firstview:celebrated:${viewer}:${seasonId}`
  ├─ hasSeen via useSyncExternalStore (subscribes to window 'storage' event)
  └─ markAsSeen = () => localStorage.setItem(storageKey, ISO_timestamp)

RaffleDetails  ──┬─ uses gate for the open season
                 └─ mounts <WinnerCelebrationModal variant=… onDismiss=gate.markAsSeen />

RaffleList  ─── uses useFirstViewGateBatch('celebrated', seasonIds) ──> overrides
                getSeasonGroup() result: `complete` → `settling` when !seen.
```

The hook is generic on purpose so future "show once" UI (onboarding nudges, new-feature callouts) can reuse it: `useFirstViewGate('onboarding-tip', 'buy-sell-widget')`. The first scope is `'celebrated'`; the call-sites do not encode the scope name in more than one place.

`getSeasonGroup` itself stays a pure status→bucket mapper (already tested today). The viewer override is layered on at the call site in `RaffleList`'s existing bucket `useMemo`, not folded into the mapper.

## Files

**New:**
- `packages/frontend/src/hooks/useFirstViewGate.js`
- `packages/frontend/src/hooks/useFirstViewGate.test.js`
- `packages/frontend/src/components/raffle/celebration/WinnerCelebrationModal.jsx`
- `packages/frontend/src/components/raffle/celebration/WinnerCelebrationModal.test.jsx`
- `packages/frontend/src/components/raffle/celebration/CelebrationArtwork.jsx` — pure SVG composition (box, ticket, rays); framer-motion timeline lives here
- `packages/frontend/src/components/raffle/celebration/confetti.js` — thin wrapper around `canvas-confetti` exposing `fireWinBurst({ scaled })` and `reset()`; bails out under reduced-motion
- `packages/frontend/src/components/raffle/celebration/sponsoredPrizeLabel.js` — pure helper producing the one-line addon string from `useSponsoredPrizes` data

**Modified:**
- `packages/frontend/src/routes/RaffleDetails.jsx` — mount modal in the completed/cancelled branch
- `packages/frontend/src/routes/RaffleList.jsx` — apply viewer override to bucket assignment
- `packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx` — pre-seed gate so existing assertions still hold; add a new test for the modal path
- `packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx` — NEW alongside existing list tests
- `packages/frontend/package.json` — add `canvas-confetti ^1.9.x`; bump version `0.39.11` → `0.40.0`
- `packages/frontend/public/locales/en/raffle.json` — new `celebration.*` keys

## Hook API

`packages/frontend/src/hooks/useFirstViewGate.js`

```jsx
// Singular: for one item
const { hasSeen, markAsSeen } = useFirstViewGate('celebrated', seasonId);

// Batch: for lists. Returns a stable Set of seen itemKeys.
const seenSet = useFirstViewGateBatch('celebrated', seasonIds);
// seenSet.has(seasonId) → boolean
```

Internals:

- `viewer` derived from `useAccount().address?.toLowerCase() ?? 'anon'`. When `address` is undefined (anon), all reads/writes use the `anon` key namespace.
- `storageKey(scope, itemKey)` = `` `sof:firstview:${scope}:${viewer}:${String(itemKey)}` ``. The `String()` coercion is load-bearing: `RaffleList` passes BigInt season ids (`s.id`) while `RaffleDetails` passes JS numbers (`seasonIdNumber`); both `String(42n)` and `String(42)` produce `"42"` so the same season resolves to the same key from either call site.
- `hasSeen` uses `useSyncExternalStore`:
  - `subscribe` = attach a `storage` event listener on `window`, filter for matching key
  - `getSnapshot` = `!!localStorage.getItem(storageKey)`
  - `getServerSnapshot` = `false` (SSR-safe; nothing has been seen on the server)
- `markAsSeen` writes ISO timestamp; reading the timestamp value is reserved for future debugging but not exposed in the API.
- Storage failures (private browsing, quota) are swallowed; `hasSeen` then permanently returns `false` — modal will show on every visit, which is acceptable degradation.
- The batch variant computes the Set once per `itemKeys` array reference; consumers must memoise the array. The returned Set is referentially stable when no underlying key flipped, so downstream `useMemo` deps that include it do not thrash.
- `markAsSeen` is idempotent: re-calling overwrites with a fresh timestamp but never flips `hasSeen` back to false. Callers (modal mount, tap, auto-dismiss) can all invoke it without coordination.

## Modal API

`packages/frontend/src/components/raffle/celebration/WinnerCelebrationModal.jsx`

```jsx
<WinnerCelebrationModal
  variant="celebrate" // 'celebrate' | 'win' | 'cancelled'
  winnerAddress="0x…" // omit for cancelled
  grandPrizeWei={1234n} // omit for cancelled
  sponsoredPrizeLabel="Punk #4242" // optional, for celebrate/win
  seasonId={42n} // forwarded to ClaimPrizeWidget in 'win'
  onDismiss={() => gate.markAsSeen()}
/>
```

State owned internally: `dismissed` flag, auto-dismiss timer ref. Mounting calls `onDismiss` immediately so the gate is marked seen — additional taps just close the modal. Cleanup clears the timer and calls `confetti.reset()`.

Variants are pure prop branches inside the component (one file). If a variant grows beyond ~80 LOC we split into `CelebrateContent`, `WinContent`, `CancelledContent` siblings.

## Animation timeline (variant = `celebrate` / `win`)

| t (s) | Element | Action | Duration |
|------|---------|--------|----------|
| 0.0 | Backdrop | fade in to `bg-background/80 backdrop-blur-sm` | 200ms |
| 0.0 | Modal card | spring scale 0.92 → 1.0 | 300ms |
| 0.2 | SVG box | bounce in + lid hinge opens | 300ms |
| 0.5 | Ticket SVG | translateY −60 → 0, scale 0.6 → 1, ease-out | 500ms |
| 1.0 | Rays SVG | continuous rotation 8s/rev, linear | — |
| 1.0 | Confetti | `canvas-confetti` two-angle burst (~120 particles) | ~2.5s |
| 1.0 | Winner name | fade + translateY 8 → 0 | 400ms |
| 1.1 | Amount | same animation, 100ms stagger | 400ms |
| 1.6 | Sponsored prize line | fade in if present | 300ms |
| 6.0 | All | auto-dismiss fade-out if no tap | 300ms |

**`cancelled` variant:** backdrop + modal mount; ticket appears already pulled; shrinks/desaturates over ~700ms; "Season cancelled · funds refunded" copy; no confetti, no rays. Auto-dismiss at 4s.

**Reduced motion (`window.matchMedia('(prefers-reduced-motion: reduce)').matches`):**
- Skip ticket-pull, ray rotation, and confetti
- Render the composed final state immediately
- Still mount modal, still call `onDismiss` on mount, still auto-dismiss at 4s

## Data flow on the route

### RaffleDetails — completed/cancelled branch

```jsx
const gate = useFirstViewGate('celebrated', seasonIdNumber);

const isCompleted = statusNum === 5;
const isCancelled = statusNum === 6;
const winnerAddr = winnerSummaryQuery?.data?.winnerAddress ?? null;
const winnerDataReady = isCancelled || (isCompleted && winnerAddr);

const variant = isCancelled
  ? 'cancelled'
  : winnerAddr?.toLowerCase() === connectedAddress?.toLowerCase()
    ? 'win'
    : 'celebrate';

return (
  <>
    {!gate.hasSeen && winnerDataReady && (
      <WinnerCelebrationModal
        variant={variant}
        winnerAddress={winnerAddr}
        grandPrizeWei={winnerSummaryQuery?.data?.grandPrizeWei}
        sponsoredPrizeLabel={topSponsoredPrizeLabel /* derived from useSponsoredPrizes tier 0 */}
        seasonId={BigInt(seasonIdNumber)}
        onDismiss={gate.markAsSeen}
      />
    )}
    {/* existing CompletedRaffleResults card and following sections unchanged */}
  </>
);
```

`topSponsoredPrizeLabel` is derived once from the existing `useSponsoredPrizes(seasonId, { enabled: true })` hook by reading the tier-0 prize (ERC-20 amount + symbol, or ERC-721 collection name + tokenId). If no tier-0 sponsored prize exists, the prop is omitted and the modal hides that line.

### RaffleList — bucket override

```jsx
const seasonIds = useMemo(() => displayed.map((s) => s.id), [displayed]);
const seenSet = useFirstViewGateBatch('celebrated', seasonIds);

const buckets = useMemo(() => {
  const out = { upcoming: [], active: [], settling: [], complete: [] };
  for (const s of displayed) {
    let g = getSeasonGroup(s.status);
    if (g === 'complete' && !seenSet.has(s.id)) g = 'settling';
    if (out[g]) out[g].push(s);
  }
  return out;
}, [displayed, seenSet]);
```

The Complete tab's existing winner-summary query (`{ enabled: activeTab === "complete" }`) does not need adjustment; held-back seasons simply don't appear in the Complete bucket until seen, at which point the user has already opened RaffleDetails and the modal has loaded the winner data.

## Edge cases

- **Loading race**: status 5 but `winnerSummaryQuery` still loading → `winnerDataReady` is false → modal does not mount. When data resolves, modal mounts (still counts as first view).
- **No winner address on a completed season** (transient data anomaly): `winnerDataReady` false; gate stays unseen; Raffle List keeps the season in Settling until data arrives.
- **localStorage unavailable** (private mode, quota): wrapping try/catch around get/set; `hasSeen` permanently false → modal shows every visit. Acceptable.
- **Wallet switch mid-session**: viewer key changes → new gate identity. Previous wallet's seen-state preserved under its own key.
- **Multiple completed seasons unseen at once**: each season has its own key; user works through them as they open each Raffle Detail page. The Raffle List Settling tab can briefly contain many.
- **Auto-dismiss vs user tap**: both clear the timer; idempotent `onDismiss` (the gate already records seen on mount).
- **Confetti canvas leak**: `useEffect` cleanup calls `confetti.reset()`; the wrapper is the only owner of the canvas.
- **Win variant + nothing to claim**: `ClaimPrizeWidget` already renders an empty state cleanly; pass through unchanged.
- **Anonymous viewer in mini-app or shared link**: shares one `anon` namespace per browser — fine, since the alternative (UUID per browser) creates orphan state with no UX benefit.
- **i18n missing keys** during dev: react-i18next falls back to key name; existing key-fallback tests cover the pattern.

## i18n keys (raffle namespace)

```
celebration.winnerLabel          = "Winner"
celebration.youWonHeadline       = "You won!"
celebration.youWonSubheadline    = "Claim your prize below or anytime later."
celebration.amountSof            = "{{amount}} SOF"
celebration.sponsoredPrizeAddon  = "+ {{prizeName}}"
celebration.continueHint         = "tap anywhere to continue"
celebration.cancelledHeadline    = "Season cancelled"
celebration.cancelledSubheadline = "Your funds will be refunded."
```

## Testing

- `useFirstViewGate.test.js`
  - reads return false initially
  - `markAsSeen` flips `hasSeen` true
  - `storage` event from another tab updates `hasSeen`
  - anon namespace when no wallet connected
  - separate keys for separate viewers / item keys
  - SSR-safe getServerSnapshot returns false
  - `useFirstViewGateBatch` returns a Set with the seen subset
  - itemKey BigInt and Number produce the same key (`String()` coercion)
- `WinnerCelebrationModal.test.jsx`
  - `celebrate` variant renders winner name + amount + sponsored line when given
  - `win` variant renders "You won!" + `ClaimPrizeWidget`
  - `cancelled` variant renders refund copy, no confetti
  - `onDismiss` fires on mount (gate auto-record)
  - `onDismiss` is idempotent across mount, tap, auto-dismiss
  - reduced-motion path: no confetti spy invocations
  - auto-dismiss timer fires at 6s (4s for cancelled)
- `RaffleDetails.completedBranch.test.jsx`
  - existing: pre-seed gate so modal does not mount → original assertions intact
  - new: completed season + unseen gate → modal mounts; after `markAsSeen` → modal does not re-mount on revisit
  - new: cancelled season + unseen gate → cancelled variant mounts
- `RaffleList.celebrationHold.test.jsx`
  - completed season with unseen gate → appears in `settling` tab content, not `complete`
  - after `markAsSeen` (storage event) → appears in `complete` tab content
  - cancelled season with unseen gate → also held in `settling`
  - upcoming/active/settling buckets unaffected

## Risks / open questions

- **Confetti perf on low-end Android in the Farcaster mini-app**: `canvas-confetti` is GPU-light but mini-app webviews vary. If we see jank in testing, drop particle count from 120 → 60 when `useAppIdentity().isMiniApp` is true.
- **Sponsored prize label**: a small pure helper `formatTopSponsoredPrize(useSponsoredPrizes return value)` lives in `packages/frontend/src/components/raffle/celebration/sponsoredPrizeLabel.js`. It reads tier-0 ERC-20 first (preferring symbol over address), then tier-0 ERC-721 (collection name + tokenId, falling back to `"Sponsored prize"` if `name()` is missing). Unit-tested in isolation.
- **Settling-tab counter inflation**: held-back seasons add to the Settling tab badge count. This is the intended behavior (mystery preservation) but worth eyeballing if the count grows large for a long-time user.

## Version bump

`packages/frontend/package.json`: `0.39.11` → `0.40.0` (minor — new feature).
