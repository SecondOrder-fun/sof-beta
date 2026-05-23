# Mobile raffle status tabs — design

**Date:** 2026-05-23
**Issue:** [#101 — Mobile Raffle List needs status grouping](https://github.com/SecondOrder-fun/sof-beta/issues/101)
**Branch:** `feat/mobile-raffle-status-tabs`

## Problem

Desktop `RaffleList` groups seasons into four tabs (Upcoming / Active / Settling / Complete) via `getSeasonGroup(statusNum)` and `<Tabs>` from `@/components/ui/tabs`. The Farcaster MiniApp and mobile-browser views render `MobileRafflesList`, a single-queue carousel with no status filtering — every season scrolls past in one queue regardless of state.

PR #99 (raffle winner celebration) worked around this by excluding unseen Completed seasons from the mobile carousel entirely, preserving the spoiler. That filter masked the deeper issue: mobile users have no way to navigate by status — including users who already saw everything and just want to look at Completed or Upcoming raffles.

This spec brings the four-tab grouping to mobile and unifies the active-tab persistence story across all three UI spaces (desktop, mobile browser, Farcaster MiniApp).

## Goals

- Mobile users can filter the raffle carousel by the same four status groups desktop already exposes.
- The active tab is consistent and deep-linkable across desktop, mobile browser, and Farcaster MiniApp via a URL param (`?tab=<group>`).
- The PR #99 spoiler hold is unified: unseen Completed raffles demote to the Settling tab on both surfaces (with winner suppressed), instead of vanishing from mobile entirely.
- Empty tabs render a clear "nothing here yet" state — no broken-looking blank screen.
- Existing carousel ergonomics (per-raffle pagination, `onActiveSeasonChange` for gating) are preserved.

## Non-goals

- Per-tab carousel position memory (carousel jumps to index 0 on tab change).
- New status groups beyond the four desktop already has.
- Sort/filter controls beyond tabs + Mine (no "newest first" / "ending soon" UI).
- Notification deep-links into specific raffles (the URL syncs the tab, not the carousel index — that's a separate enhancement).
- Migration shims for the URL param (this is alpha; old links without `?tab=` default to `"active"`).

## Architecture

The smallest change that fits: lift tab state out of being desktop-only and into the layer that both desktop and mobile share, then teach the existing mobile carousel to receive a pre-bucketed list instead of a flat list.

### Files modified

- `packages/frontend/src/routes/RaffleList.jsx` — owns URL `?tab=` sync; passes `grouped`, `activeTab`, `onTabChange` to mobile (replacing today's `mobileSeasons`).
- `packages/frontend/src/components/mobile/MobileRafflesList.jsx` — wraps the existing carousel in `<Tabs>`, renders four pill-styled `<TabsTrigger>` items with count chips.

No new component files. All shadcn `<Tabs>` styling for the pill look is applied via `className` overrides on existing primitives.

### Component responsibilities

- **`RaffleList.jsx`**
  - Reads `activeTab` from `useSearchParams` (`?tab=<group>`), defaults to `"active"` when absent or invalid.
  - Writes `?tab=<group>` on tab change via `setSearchParams`, alongside the existing `?filter=mine`.
  - Computes `grouped` (existing logic, unchanged) and feeds both desktop `<Tabs>` and mobile `<MobileRafflesList>` from the same object.
  - Replaces the desktop-only `useState("active")` with the URL-backed value.
  - Removes the desktop-only `mobileSeasons` flat-filter; mobile reads `grouped[activeTab]` instead.

- **`MobileRafflesList.jsx`**
  - New props: `grouped` (the bucketed object), `activeTab` (current key), `onTabChange` (forwards setSearchParams).
  - Wraps the existing carousel in `<Tabs value={activeTab} onValueChange={onTabChange}>`.
  - Renders a horizontally scrollable `<TabsList>` with four `<TabsTrigger>` items, each showing the group name and count chip (count = `grouped[group].length`).
  - Triggers styled as pills via `className`: rounded-full, primary-bg when active, secondary-bg otherwise. No fork of the primitive.
  - Carousel reads `grouped[activeTab]` and resets `currentIndex` to 0 on tab change.
  - Empty groups render the existing `raffle.emptyTab.<group>` i18n key inside the carousel slot (dashed-border placeholder).

### Data flow

```
URL ?tab=settling&filter=mine
        │
        ▼
RaffleList: activeTab = validated(searchParams.get("tab")) ?? "active"
            showMineOnly = searchParams.get("filter") === "mine"
        │
        ▼
allSeasonsQuery.data
        │ sort by id desc
        │ filter by Mine (if toggle on)
        ▼
displayedSeasons
        │ + seenSet (PR #99 first-view gate)
        ▼
grouped = { upcoming: [...], active: [...], settling: [...], complete: [...] }
        │ (unseen completed demoted to 'settling' with suppressWinner: true)
        │
        ├──► desktop:  <Tabs value={activeTab}> → grouped[activeTab] in a grid
        │
        └──► mobile:   <Tabs value={activeTab}> → grouped[activeTab] in the carousel
                       counts come from { upcoming: 2, active: 3, ... }
                       on tab change → setSearchParams(...) → re-render
```

### URL contract

- `?tab=upcoming|active|settling|complete` — active tab.
- Missing or unknown value → defaults to `"active"`. Defensive against bad share links.
- Coexists with `?filter=mine`; either can be present independently.
- Writing the param uses the existing `setSearchParams` callback form so other params are preserved.

### Existing contracts preserved

- `onActiveSeasonChange` still fires on carousel index change → `useSeasonGating` hook unaffected.
- BuySellSheet / PasswordGateModal / SignatureGateModal flows untouched.
- `winnerSummariesQuery` retains `enabled: activeTab === "complete"` (saves an RPC round-trip when not on Complete).
- Desktop default behavior preserved when `?tab=` is absent (renders Active, same as today).

## Visual design

Pill-styled `<TabsTrigger>` row sits on its own line between the existing mobile title row (Raffles + Mine + 1/N pager) and the carousel.

- Pill row: ~40px tall including padding, horizontally scrollable (4 pills fit on a 390px viewport with headroom for future groups).
- Count chips use the same structure as desktop's existing trigger markup; styled in primary when the pill is active, neutral otherwise.
- Card height auto-shrinks via the existing `cardRef.current.getBoundingClientRect().top` math — no changes to the height calculator.
- Footer (~120px reserved) stays fully clear; the pill row eats from the card slot, not the footer reservation.
- Empty state: dashed-border placeholder in the card slot with the `raffle.emptyTab.<group>` translation. Pager nav hides when the active group has < 2 items.

## Spoiler hold (PR #99 integration)

Unseen Completed raffles are **demoted to Settling** on both desktop and mobile (mirrors desktop's existing behavior). The mobile-specific `mobileSeasons` exclude filter from PR #99 is removed in favor of the unified demotion path. After the user lands on the celebration detail page and `useFirstViewGate` records the visit, the raffle promotes back to Complete on the next render.

`suppressWinner: true` continues to flow through to the mobile `SeasonCard` so the demoted card still hides the winner identity until viewed.

## i18n

All keys already exist from the desktop launch:

- `raffle.tabs.upcoming` / `.active` / `.settling` / `.complete`
- `raffle.emptyTab.upcoming` / `.active` / `.settling` / `.complete`

No new keys needed. All 9 locale files already carry these.

## Testing

TDD with co-located tests in `packages/frontend/src/routes/__tests__/` and `packages/frontend/src/components/mobile/__tests__/`.

### New tests

- `RaffleList.urlTabSync.test.jsx`
  - Mounting with `?tab=settling` renders the Settling tab as active on both desktop and mobile shells.
  - Clicking a different tab updates `?tab=` in the URL via `setSearchParams`.
  - Unknown `?tab=foo` falls back to `"active"` (no console error).
  - `?tab=` absent → defaults to `"active"`.

- `MobileRafflesList.tabs.test.jsx`
  - Renders 4 `TabsTrigger`s with correct count chips from a mock `grouped` object.
  - Empty tab renders the `emptyTab.<group>` translation in the carousel slot.
  - Switching tabs calls the parent's `onTabChange` with the new group key.
  - `onActiveSeasonChange` fires with the first season of the newly selected tab (preserves gating contract).

### Extended tests

- `RaffleList.celebrationHold.test.jsx`
  - Add a mobile case: unseen Completed raffle surfaces in `grouped.settling` on mobile (currently the test only covers desktop demotion).
  - Confirm that after seenSet records the visit, it promotes to `grouped.complete` on next render.

## Edge cases

- All four tabs empty (e.g. mid-deploy with no seasons): falls through to the existing "no active seasons" branch — no regression.
- User on `?tab=complete` when the last Completed gets demoted to Settling by seenSet update: Complete count drops to 0, user stays on Complete (empty state, not auto-switch — auto-switching would be surprising).
- Mine toggle ON + tab switch: `grouped` is computed *after* the Mine filter, so counts reflect the Mine view. Toggling Mine off restores full counts without changing the active tab.
- Tab in URL but `displayedSeasons` still loading: skeleton renders first; `activeTab` from URL is applied once data arrives. No flash to default.

## Version bump

Frontend: minor (`feat`) — e.g. `0.41.3` → `0.42.0`.
