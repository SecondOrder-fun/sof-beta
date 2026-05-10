# Raffle List — design upgrade

**Date:** 2026-05-10
**Status:** spec — pending implementation plan
**Scope:** Desktop `RaffleList` view (`packages/frontend/src/routes/RaffleList.jsx`). Mobile `MobileRafflesList` is **out of scope** for this upgrade (deferred to a later mobile/Farcaster pass).

## Goals

Three user-driven changes to the desktop Raffle List:

1. Categorize seasons into tab groups so the list stops mixing in-flight, completed, and not-yet-started seasons in one undifferentiated grid.
2. Remove the bonding-curve preview from cards in the Complete tab — it's no longer informative once the season is finalized.
3. Remove the price + Buy/Sell affordance from cards in the Complete tab — trading is locked, and the price is meaningless after settlement.

A side bug surfaced during design and is folded in: `isCompleted = (statusNum === 4 ‖ statusNum === 5)` is too coarse — status 2 (EndRequested) and 3 (VRFPending) leak through as "active" cards today, showing curve, "Current Price", and Buy/Sell buttons even though trading is locked. The new design routes those statuses to a Settling tab where they get a status pill + time-elapsed-since-lock indicator instead.

## Status enum → tab mapping

The `SeasonStatus` enum has 7 values; the design maps them to 4 tabs:

| Tab        | Statuses                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Upcoming   | `0 NotStarted`                                                                                    |
| Active     | `1 Active`                                                                                        |
| Settling   | `2 EndRequested`, `3 VRFPending`, `4 Distributing`                                                |
| Complete   | `5 Completed`, `6 Cancelled`                                                                      |

A 4th tab — Settling — was added because the in-flight states are visually distinct from both Active (still trading) and Complete (terminal), and bundling them into either felt wrong.

## Tab strip UX

- **Component:** existing `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` from `@/components/ui/tabs`. **No changes** to that component file. The pill-style strip with sliding cochineal-red indicator is preserved.
- **Count badges:** each `TabsTrigger` composes a count `Badge` next to the label. Inactive triggers use the existing `Badge variant="secondary"` (pastel rose, black text). Active trigger uses a white pill with primary-red text — `bg-background text-primary` — for high contrast on the red indicator.
- **Default tab:** always `Active`. No URL persistence in this round.
- **"My Raffles" toggle:** applies globally — filters the dataset before bucketing into tabs, so count badges always reflect the filtered set.
- **Empty states per tab:** muted "Nothing here yet" copy; reuses `t("noActiveSeasons")`-style i18n key, parameterized per tab name.

All colors and borders via theme tokens (`--primary`, `--secondary`, `--muted`, `--border`, `--background`, etc.). No hardcoded hex.

## Card variants per tab

The single `ActiveSeasonCard` component (current name is misleading — it renders all seasons regardless of status) gets a per-tab body variant. Header (id + name + status badge) is unchanged across all four. Countdowns in the header (pre-start "Starts in" or active "Ends in") also stay where they are.

### Upcoming card (status 0)
**Unchanged from today.** Header with countdown to start, bonding-curve mini-graph, "Starting Price (SOF)" label, no Buy/Sell buttons.

### Active card (status 1)
**Unchanged from today.** Header with countdown to end, bonding-curve mini-graph, "Current Price" label, Buy/Sell buttons.

### Settling card (statuses 2, 3, 4) — NEW
- **Drops:** bonding-curve graph, price label, Buy/Sell buttons, end-countdown.
- **Replaces with:** a centred indicator block — small uppercase label "Trading locked" plus monospaced "X min ago" time-elapsed display.
- **Status pill in header** maps per status:
  - `2 EndRequested` → "Awaiting end…"
  - `3 VRFPending` → "Drawing winner…"
  - `4 Distributing` → "Distributing prizes…"
- **Time-elapsed source:** the lock event happens inside `Raffle.requestSeasonEnd()` / `requestSeasonEndEarly()` — the `seasonStates[id].vrfRequestTimestamp` field is set at lock time and is already exposed via `getSeasonDetails`. If that field isn't already in the frontend's season payload, surface it via `useAllSeasons` (or the per-season query). Fall back to `endTime` if `vrfRequestTimestamp` is unavailable.
- The `CountdownTimer` component currently counts *down* to a future timestamp. Either extend it with an `elapsed` mode that counts forward from a past timestamp, or write a small `<TimeElapsed timestamp={…} />` component (~10 lines). Recommend the latter — keeps `CountdownTimer` single-purpose.

### Complete card — winner variant (status 5)
**Unchanged from today.** Existing winner box (UsernameDisplay + Grand Prize) when a winner exists; "No Winner / No Participants" box when `totalTickets === 0`.

### Complete card — cancelled variant (status 6) — NEW
- **Status pill** in header: "Cancelled" (uses existing `Badge variant="destructive"` or a softer "statusCancelled" variant — verify before assuming).
- **Body:** a single muted indicator box with "Season cancelled. No payout." copy. No curve, no price, no winner.

## Component-level changes

| File                                                                | Change                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/frontend/src/routes/RaffleList.jsx`                       | Bucket `displayedSeasons` into 4 status groups; render `Tabs` + 4 `TabsTrigger`s with count badges + 4 `TabsContent`s; "My Raffles" filter applies globally. |
| `packages/frontend/src/routes/RaffleList.jsx` (`ActiveSeasonCard`)  | Refactor `isCompleted` from `(4 ‖ 5)` to per-status branching; add Settling-card body and Cancelled-card body. Rename component to `SeasonCard` while we're here (current name is misleading). |
| `packages/frontend/src/components/ui/badge.jsx`                     | If a `statusSettling` variant doesn't already exist, add one (warning-tinted, matches existing status-* variant family). Verify before adding — do **not** add if a suitable variant exists. |
| `packages/frontend/src/components/common/TimeElapsed.jsx` (NEW)     | Small component (~10 lines) that renders `Math.floor((Date.now()/1000 - target) / 60)` minutes elapsed, refreshed every 30s. Theme-token text colors. |
| `packages/frontend/public/locales/{en,…}/raffle.json`               | New i18n keys: tab labels, "Trading locked", per-status settling labels, "Cancelled" copy, "Season cancelled. No payout."                                            |

No changes to `tabs.jsx`, `card.jsx`, `BondingCurvePanel`, or `CountdownTimer`.

## Branch decomposition

Three sequential feature branches. Each is shippable and reviewable on its own; later branches build on earlier ones.

### Branch 1 — `feat/raffle-list-tabs`
- Bucket `displayedSeasons` into 4 status groups.
- Render `Tabs` with count badges (composition only, no `tabs.jsx` edits).
- Active tab default; "My Raffles" filter applies globally.
- Empty-state copy per tab.
- **No card content changes** — existing cards just appear under whichever tab their status maps to. The pre-existing curve/price leakage on status 2/3 still exists after this branch — fixed in branch 2.
- New i18n keys for tab labels and empty states.

### Branch 2 — `feat/raffle-list-settling-card`
- Replace the coarse `isCompleted = (4 ‖ 5)` gate with three precise checks: `isUpcoming = 0`, `isActive = 1`, `isSettling = (2 ‖ 3 ‖ 4)`, `isComplete = (5 ‖ 6)`.
- New Settling card body for statuses 2/3/4: status pill + "Trading locked / X min ago" indicator.
- Hide bonding-curve graph, price label, Buy/Sell buttons whenever `!isActive` — that closes the existing leak where status 2/3 cards show curve/price/buttons today.
- New `TimeElapsed` component.
- Surface `vrfRequestTimestamp` via the season hook if not already there.
- New i18n keys for settling labels.
- After this branch, Complete cards (status 5) already render the same as today (winner box only) — branch 3 just adds the Cancelled variant on top.

### Branch 3 — `feat/raffle-list-complete-cleanup`
- Cancelled card variant for status 6: status pill + "Season cancelled. No payout." indicator. **This variant is future-proofing** — no live testnet raffle has hit Cancelled yet, but the path exists in the contract (`cancelStuckSeason()` after VRF timeout) and may surface in the wild on mainnet.
- Verify status-5 winner card is fully clean (no curve, no price, no Buy/Sell). If branch 2 was implemented correctly, this is already the case and branch 3 is a no-op confirmation plus the Cancelled variant.
- New i18n keys for cancelled copy.

Each branch ends with: lint clean, tests green (`npm test`, `npm run lint`), preview env up via `pr-preview.yml`. Each follows `github-pr-workflow` Phase 1 (branch from `origin/main`) and Phase 2 (push + open PR at first meaningful commit).

## Out of scope

- **Mobile.** `MobileRafflesList` and `MobileRaffleDetail` keep current behavior. A future mobile/Farcaster UI pass will revisit categorization there.
- **URL state for tab selection** (`?tab=`) — easy to add later; not needed for v1.
- **Tab order persistence across sessions** (e.g. localStorage) — not needed.
- **Per-season detail page** (`RaffleDetails.jsx`) — separate page, separate concern. Already has its own status-aware UI.
- **Removing or renaming the existing `ActiveSeasonCard`** is folded into branch 1 as a tactical rename to `SeasonCard` (current name lies about what it renders). If that rename creates merge friction, it can be deferred.

## Theme & components inventory

Components reused (no edits):
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (`@/components/ui/tabs`)
- `Card`, `CardHeader`, `CardContent` (`@/components/ui/card`)
- `Badge` (`@/components/ui/badge`) — using existing `secondary`, `statusActive`, `statusUpcoming`, `statusCompleted` variants. Possibly adds `statusSettling` and/or `statusCancelled` if missing.
- `Button` (`@/components/ui/button`)
- `Switch` (`@/components/ui/switch`) — for "My Raffles" toggle, unchanged
- `BondingCurvePanel` (`@/components/curve/CurveGraph`)
- `CountdownTimer` (`@/components/common/CountdownTimer`)
- `UsernameDisplay` (`@/components/user/UsernameDisplay`)

New component:
- `TimeElapsed` (`@/components/common/TimeElapsed`) — ~10-line pure render.

Theme tokens used (all from `src/styles/tailwind.css`):
- `--primary`, `--primary-foreground` (Cochineal Red active state)
- `--secondary`, `--secondary-foreground` (Pastel Rose inactive badges)
- `--background`, `--foreground` (white badge fill on active trigger)
- `--muted`, `--muted-foreground` (Settling card body, empty states)
- `--border` (card and tab borders)
- `--warning`, `--warning-foreground` (Settling status pill — verify variant maps to this)
- `--destructive` (Cancelled status pill)

No hardcoded hex anywhere. All borders, fills, text colors via Tailwind semantic classes (`bg-primary`, `text-foreground`, `border-border`, etc.).
