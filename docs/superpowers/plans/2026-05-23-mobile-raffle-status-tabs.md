# Mobile Raffle Status Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring desktop's 4-tab raffle status grouping (Upcoming/Active/Settling/Complete) to `MobileRafflesList`, with URL-based `?tab=<group>` persistence shared by all three UI spaces (desktop, mobile browser, Farcaster MiniApp).

**Architecture:** Lift `activeTab` state in `RaffleList.jsx` from local `useState` into `useSearchParams` so both desktop and mobile read the same URL-backed value. Pass the existing `grouped` object (already does PR #99 spoiler demotion) and `activeTab` to `MobileRafflesList`. Wrap mobile's existing carousel in the shadcn `<Tabs>` primitive — it already renders as a pill row with a sliding indicator, so no new component needed. Remove the obsolete `mobileSeasons` flat-filter — the unified `grouped` demotion path replaces it.

**Tech Stack:** React 18, react-router-dom `useSearchParams`, shadcn `<Tabs>` (radix-ui under the hood), Vitest + React Testing Library, Tailwind CSS, react-i18next.

**Spec:** `docs/superpowers/specs/2026-05-23-mobile-raffle-status-tabs-design.md`

---

## File Structure

**Modified:**
- `packages/frontend/src/routes/RaffleList.jsx` — lift `activeTab` to URL, pass new props to mobile, remove `mobileSeasons`.
- `packages/frontend/src/components/mobile/MobileRafflesList.jsx` — wrap carousel in `<Tabs>`, render four `<TabsTrigger>` with count chips, handle empty-state per group.
- `packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx` — extend to cover mobile demotion case.
- `packages/frontend/package.json` — bump `0.41.3` → `0.42.0`.

**Created:**
- `packages/frontend/src/routes/__tests__/RaffleList.urlTabSync.test.jsx` — URL sync behavior.
- `packages/frontend/src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx` — mobile tabs rendering, count chips, empty state, gating-contract preservation.

---

## Task 1: URL `?tab=` sync in RaffleList

Lift `activeTab` from local state to URL search param. Pure refactor — desktop behavior unchanged when no `?tab=` present (defaults to `"active"`). Mobile is not affected yet (still uses `mobileSeasons`).

**Files:**
- Create: `packages/frontend/src/routes/__tests__/RaffleList.urlTabSync.test.jsx`
- Modify: `packages/frontend/src/routes/RaffleList.jsx` (lines 41-53 area)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/routes/__tests__/RaffleList.urlTabSync.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RaffleList from '../RaffleList';

// Stub heavy descendants — this test exercises URL sync only.
vi.mock('@/components/raffles/SeasonCard', () => ({
  SeasonCard: ({ season }) => <div data-testid={`season-card-${season.id}`} />,
}));
vi.mock('@/components/mobile/MobileRafflesList', () => ({
  default: ({ activeTab, onTabChange }) => (
    <div data-testid="mobile-list" data-active-tab={activeTab}>
      <button onClick={() => onTabChange?.('settling')}>mobile-set-settling</button>
    </div>
  ),
}));
vi.mock('@/components/mobile/BuySellSheet', () => ({ default: () => null }));
vi.mock('@/components/gating/PasswordGateModal', () => ({ default: () => null }));
vi.mock('@/components/gating/SignatureGateModal', () => ({ default: () => null }));
vi.mock('@/components/common/skeletons/SeasonCardSkeleton', () => ({ default: () => <div /> }));

vi.mock('@/hooks/useAllSeasons', () => ({
  useAllSeasons: () => ({
    data: [
      { id: 1, status: 0, totalTickets: 0n, config: { name: 'Up', startTime: 0n, endTime: 0n, bondingCurve: '0xa' } },
      { id: 2, status: 1, totalTickets: 0n, config: { name: 'Act', startTime: 0n, endTime: 0n, bondingCurve: '0xb' } },
      { id: 3, status: 3, totalTickets: 0n, config: { name: 'Set', startTime: 0n, endTime: 0n, bondingCurve: '0xc' } },
      { id: 4, status: 5, totalTickets: 0n, config: { name: 'Done', startTime: 0n, endTime: 0n, bondingCurve: '0xd' } },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummaries: () => ({ data: {} }),
}));
vi.mock('@/hooks/useFirstViewGate', () => ({
  useFirstViewGateBatch: () => new Set(['4']), // mark season 4 as seen so it stays in 'complete'
}));
vi.mock('@/hooks/useProfileData', () => ({
  useProfileData: () => ({ seasonBalancesQuery: { data: [] } }),
}));
vi.mock('@/hooks/useSeasonGating', () => ({
  useSeasonGating: () => ({ isVerified: true, gates: [], refetch: vi.fn() }),
  GateType: { SIGNATURE: 1 },
}));
vi.mock('@/hooks/useRaffleAccount', () => ({
  useRaffleAccount: () => ({ sma: '0xaaa' }),
}));
vi.mock('@/hooks/useLoginModal', () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: false, isFarcaster: false }),
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0xuser', isConnected: true, chainId: 84532 }),
  useChains: () => [],
}));

const renderAt = (initialPath) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/raffles" element={<RaffleList />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('RaffleList URL ?tab= sync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mounting with ?tab=settling activates the Settling tab', () => {
    renderAt('/raffles?tab=settling');
    expect(screen.getByRole('tab', { name: /settling/i })).toHaveAttribute('data-state', 'active');
  });

  it('mounting with no ?tab= defaults to Active', () => {
    renderAt('/raffles');
    expect(screen.getByRole('tab', { name: /active/i })).toHaveAttribute('data-state', 'active');
  });

  it('unknown ?tab=foo falls back to Active without console errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('/raffles?tab=foo');
    expect(screen.getByRole('tab', { name: /active/i })).toHaveAttribute('data-state', 'active');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('clicking a tab updates the URL ?tab= param', () => {
    const { container } = renderAt('/raffles');
    fireEvent.click(screen.getByRole('tab', { name: /complete/i }));
    // After click, the Complete tab should be active (URL is the source of truth)
    expect(screen.getByRole('tab', { name: /complete/i })).toHaveAttribute('data-state', 'active');
    // suppressUnused
    expect(container).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/routes/__tests__/RaffleList.urlTabSync.test.jsx`
Expected: `?tab=settling` test FAILS (current code uses `useState("active")`, ignores URL).

- [ ] **Step 3: Implement URL-backed activeTab in RaffleList.jsx**

In `packages/frontend/src/routes/RaffleList.jsx`, replace the existing `activeTab` state (around line 53):

Find:
```jsx
  const [activeTab, setActiveTab] = useState("active");
```

Replace with:
```jsx
  // activeTab is URL-backed (?tab=<group>) so it persists across reloads,
  // shares-links, and stays consistent between desktop and mobile views.
  // Invalid or missing values fall back to "active".
  const VALID_TABS = ["upcoming", "active", "settling", "complete"];
  const urlTab = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(urlTab) ? urlTab : "active";
  const setActiveTab = useCallback(
    (next) => {
      setSearchParams((prev) => {
        if (next === "active") {
          prev.delete("tab"); // keep URLs clean when on the default
        } else {
          prev.set("tab", next);
        }
        return prev;
      });
    },
    [setSearchParams],
  );
```

Then move `VALID_TABS` outside the component (top of the file, after `getSeasonGroup`):

```jsx
const VALID_TABS = ["upcoming", "active", "settling", "complete"];
```

And remove the duplicate inside the component body so it reads:

```jsx
  const urlTab = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(urlTab) ? urlTab : "active";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/routes/__tests__/RaffleList.urlTabSync.test.jsx`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full RaffleList test file to verify no regressions**

Run: `cd packages/frontend && npx vitest run src/routes/__tests__/raffleListBuckets.test.jsx src/routes/__tests__/RaffleList.celebrationHold.test.jsx`
Expected: all PASS (no behavior change for the existing tests — default is still "active").

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/routes/RaffleList.jsx packages/frontend/src/routes/__tests__/RaffleList.urlTabSync.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): URL-backed active tab in RaffleList (#101)

Lifts activeTab from local useState to ?tab=<group> URL param so the
active tab persists across reloads, is deep-linkable from notifications
and shared links, and stays consistent between desktop and mobile views.
Invalid values fall back to "active" defensively. URL omits ?tab= when
on the default to keep links clean.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Mobile Tabs (data + UI in one atomic change)

Replace `mobileSeasons` flat-list with bucketed grouping; wrap the mobile carousel in `<Tabs>` with four pill triggers. Unifies the PR #99 spoiler hold (unseen Completed now demote to Settling on mobile, matching desktop, instead of vanishing).

**Files:**
- Create: `packages/frontend/src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx`
- Modify: `packages/frontend/src/components/mobile/MobileRafflesList.jsx`
- Modify: `packages/frontend/src/routes/RaffleList.jsx` (remove `mobileSeasons`, pass new props)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileRafflesList from '../MobileRafflesList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => {
      const map = {
        raffles: 'Raffles',
        'tabs.upcoming': 'Upcoming',
        'tabs.active': 'Active',
        'tabs.settling': 'Settling',
        'tabs.complete': 'Complete',
        'emptyTab.upcoming': 'No upcoming raffles right now.',
        'emptyTab.active': 'No active raffles right now.',
        'emptyTab.settling': 'No settling raffles right now.',
        'emptyTab.complete': 'No completed raffles yet.',
        'navigation:myRaffles': 'Mine',
        noActiveSeasons: 'No raffles',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => ({ curveSupply: 0n, curveStep: 0, allBondSteps: [] }),
}));
vi.mock('@/components/mobile/SeasonCard', () => ({
  default: ({ seasonId }) => <div data-testid={`mobile-card-${seasonId}`} />,
}));
vi.mock('@/components/common/skeletons/MobileCardSkeleton', () => ({
  default: () => <div data-testid="mobile-skel" />,
}));
vi.mock('@/components/common/Carousel', () => ({
  default: ({ items, renderItem, currentIndex }) =>
    items.length > 0 ? <div data-testid="carousel">{renderItem(items[currentIndex])}</div> : null,
}));

const mkSeason = (id, status) => ({
  id,
  status,
  config: { name: `S${id}`, bondingCurve: `0x${id}` },
});

const grouped = {
  upcoming: [{ season: mkSeason(1, 0), suppressWinner: false }],
  active: [
    { season: mkSeason(2, 1), suppressWinner: false },
    { season: mkSeason(3, 1), suppressWinner: false },
    { season: mkSeason(4, 1), suppressWinner: false },
  ],
  settling: [{ season: mkSeason(5, 3), suppressWinner: false }],
  complete: [
    { season: mkSeason(6, 5), suppressWinner: false },
    { season: mkSeason(7, 5), suppressWinner: false },
  ],
};

const renderList = (overrides = {}) =>
  render(
    <MemoryRouter>
      <MobileRafflesList
        grouped={grouped}
        activeTab="active"
        onTabChange={vi.fn()}
        onActiveSeasonChange={vi.fn()}
        isLoading={false}
        {...overrides}
      />
    </MemoryRouter>,
  );

describe('MobileRafflesList tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders 4 tab triggers with count chips reflecting grouped lengths', () => {
    renderList();
    expect(screen.getByRole('tab', { name: /upcoming/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /active/i })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /settling/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /complete/i })).toHaveTextContent('2');
  });

  it('renders the carousel with seasons from the active group', () => {
    renderList({ activeTab: 'active' });
    expect(screen.getByTestId('mobile-card-2')).toBeInTheDocument();
  });

  it('renders the emptyTab message when the active group has zero seasons', () => {
    const emptyGrouped = { ...grouped, upcoming: [] };
    renderList({ grouped: emptyGrouped, activeTab: 'upcoming' });
    expect(screen.getByText('No upcoming raffles right now.')).toBeInTheDocument();
    expect(screen.queryByTestId('carousel')).not.toBeInTheDocument();
  });

  it('clicking a tab fires onTabChange with the new group key', () => {
    const onTabChange = vi.fn();
    renderList({ onTabChange });
    fireEvent.click(screen.getByRole('tab', { name: /settling/i }));
    expect(onTabChange).toHaveBeenCalledWith('settling');
  });

  it('onActiveSeasonChange fires with the first season of the active group on mount', () => {
    const onActiveSeasonChange = vi.fn();
    renderList({ onActiveSeasonChange });
    expect(onActiveSeasonChange).toHaveBeenCalledWith(grouped.active[0].season);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx`
Expected: FAILS — `grouped` / `activeTab` / `onTabChange` are not yet props of `MobileRafflesList`; component currently expects `seasons` array.

- [ ] **Step 3: Update MobileRafflesList to accept grouped / activeTab / onTabChange and wrap the carousel in Tabs**

In `packages/frontend/src/components/mobile/MobileRafflesList.jsx`, make these changes:

Add imports near the top:
```jsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
```

Replace the entire component signature and body (lines 65 onward) with:

```jsx
const TAB_KEYS = ["upcoming", "active", "settling", "complete"];

export const MobileRafflesList = ({
  grouped,
  activeTab,
  onTabChange,
  isLoading,
  onBuy,
  onSell,
  onActiveSeasonChange,
  isVerified,
  isGated,
  onVerify,
  isConnected,
  onConnect,
  isFarcaster,
  showMineOnly,
  onToggleMine,
}) => {
  const { t } = useTranslation(["raffle", "navigation"]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cardHeight, setCardHeight] = useState(null);
  const cardRef = useRef(null);

  // Seasons for the currently selected tab. Reset index to 0 when the tab
  // changes (or when the active group's contents change identity), so we
  // never point at a stale slot of a different group.
  const activeSeasons = useMemo(
    () => (grouped?.[activeTab] ?? []).map((entry) => entry.season),
    [grouped, activeTab],
  );

  useEffect(() => {
    setCurrentIndex(0);
  }, [activeTab]);

  useEffect(() => {
    if (currentIndex >= activeSeasons.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, activeSeasons.length]);

  // Notify parent of active season for gating hook
  useEffect(() => {
    if (activeSeasons.length > 0 && currentIndex < activeSeasons.length) {
      onActiveSeasonChange?.(activeSeasons[currentIndex]);
    }
  }, [currentIndex, activeSeasons, onActiveSeasonChange]);

  // Calculate and lock card height to fill space between header and footer.
  // Depends on `isLoading` and `activeTab` so it re-runs when the card first
  // appears in the DOM or when tabs swap (pill row height is constant but the
  // effect re-measuring after tab change is cheap and safer than relying on it).
  useEffect(() => {
    const update = () => {
      if (!cardRef.current) return;
      const cardTop = cardRef.current.getBoundingClientRect().top;
      const navEl = document.querySelector("nav.fixed.bottom-0");
      const navHeight = navEl ? navEl.getBoundingClientRect().height : 120;
      const h = window.innerHeight - cardTop - navHeight - 12;
      setCardHeight(h);
    };
    const timer = setTimeout(update, 100);
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  }, [isLoading, activeTab]);

  const handlePrevious = () => {
    if (activeSeasons.length === 0) return;
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      setCurrentIndex(activeSeasons.length - 1);
    }
  };

  const handleNext = () => {
    if (activeSeasons.length === 0) return;
    if (currentIndex < activeSeasons.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setCurrentIndex(0);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden px-3 pt-1 pb-20">
        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{t("raffles")}</h1>
            {isConnected && (
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={showMineOnly}
                  onCheckedChange={onToggleMine}
                  id="mobile-mine-toggle"
                  className="scale-75"
                />
                <label
                  htmlFor="mobile-mine-toggle"
                  className="text-xs text-muted-foreground cursor-pointer select-none"
                >
                  {t("navigation:myRaffles")}
                </label>
              </div>
            )}
          </div>
          {!isLoading && activeSeasons.length > 1 && (
            <div className="flex items-center gap-2">
              <ButtonGroup>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handlePrevious}
                  className="h-8 w-8"
                  aria-label="Previous raffle"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleNext}
                  className="h-8 w-8"
                  aria-label="Next raffle"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </ButtonGroup>
              <span className="text-sm text-muted-foreground font-mono">
                {currentIndex + 1} / {activeSeasons.length}
              </span>
            </div>
          )}
        </div>

        {/* Status tabs — uses the existing shadcn primitive (already pill-styled
            with sliding indicator). Horizontally scrollable on narrow viewports. */}
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <div className="mb-3 overflow-x-auto">
            <TabsList>
              {TAB_KEYS.map((g) => {
                const count = grouped?.[g]?.length ?? 0;
                return (
                  <TabsTrigger
                    key={g}
                    value={g}
                    className="flex items-center gap-2 text-xs px-3 py-1.5"
                  >
                    <span>{t(`tabs.${g}`)}</span>
                    <span
                      className="inline-flex items-center justify-center min-w-[1.25rem] rounded-full border border-border px-1.5 text-[10px] font-semibold leading-4
                                 bg-secondary text-secondary-foreground
                                 [[data-state=active]_&]:bg-background
                                 [[data-state=active]_&]:text-primary"
                    >
                      {count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {TAB_KEYS.map((g) => (
            <TabsContent key={g} value={g} className="mt-0">
              {/* Loading */}
              {isLoading && <MobileCardSkeleton />}

              {/* Empty */}
              {!isLoading && activeSeasons.length === 0 && g === activeTab && (
                <Card>
                  <CardContent className="py-8">
                    <p className="text-center text-muted-foreground">
                      {t(`emptyTab.${g}`)}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Carousel — only render for the active tab to keep the existing
                  cardRef/measure path single-instance. */}
              {!isLoading && activeSeasons.length > 0 && g === activeTab && (
                <Card
                  ref={cardRef}
                  className="flex flex-col overflow-hidden"
                  style={cardHeight ? { height: cardHeight } : undefined}
                >
                  <CardContent className="p-0 flex-1 overflow-hidden">
                    <Carousel
                      items={activeSeasons}
                      currentIndex={currentIndex}
                      onIndexChange={setCurrentIndex}
                      className="h-full"
                      showArrows={false}
                      renderItem={(season) => (
                        <MobileActiveSeasonCard
                          key={season.id}
                          season={season}
                          onBuy={onBuy}
                          onSell={onSell}
                          isVerified={isVerified}
                          isGated={isGated}
                          onVerify={onVerify}
                          isConnected={isConnected}
                          onConnect={onConnect}
                          isFarcaster={isFarcaster}
                        />
                      )}
                    />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
};

MobileRafflesList.propTypes = {
  grouped: PropTypes.shape({
    upcoming: PropTypes.array,
    active: PropTypes.array,
    settling: PropTypes.array,
    complete: PropTypes.array,
  }),
  activeTab: PropTypes.oneOf(["upcoming", "active", "settling", "complete"]),
  onTabChange: PropTypes.func,
  isLoading: PropTypes.bool,
  onBuy: PropTypes.func,
  onSell: PropTypes.func,
  onActiveSeasonChange: PropTypes.func,
  isVerified: PropTypes.bool,
  isGated: PropTypes.bool,
  onVerify: PropTypes.func,
  isConnected: PropTypes.bool,
  onConnect: PropTypes.func,
  isFarcaster: PropTypes.bool,
  showMineOnly: PropTypes.bool,
  onToggleMine: PropTypes.func,
};

export default MobileRafflesList;
```

Also add `useMemo` to the existing React imports at the top:
```jsx
import { useEffect, useMemo, useState, useRef } from "react";
```

- [ ] **Step 4: Run mobile tabs test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx`
Expected: all 5 tests PASS.

- [ ] **Step 5: Update RaffleList to pass new props and drop `mobileSeasons`**

In `packages/frontend/src/routes/RaffleList.jsx`, remove the `mobileSeasons` `useMemo` block (currently around lines 282-289) entirely. Then update the mobile render branch (currently around lines 291-310) to pass `grouped` / `activeTab` / `onTabChange` instead of `seasons`:

Find:
```jsx
        <MobileRafflesList
          seasons={mobileSeasons}
          isLoading={allSeasonsQuery.isLoading}
          onBuy={handleBuy}
          onSell={handleSell}
          onActiveSeasonChange={handleActiveSeasonChange}
          isVerified={isVerified}
          isGated={isActiveGated}
          onVerify={handleVerifyActive}
          isConnected={isConnected}
          onConnect={handleConnect}
          isFarcaster={isFarcaster}
          showMineOnly={showMineOnly}
          onToggleMine={handleToggleMine}
        />
```

Replace with:
```jsx
        <MobileRafflesList
          grouped={grouped}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isLoading={allSeasonsQuery.isLoading}
          onBuy={handleBuy}
          onSell={handleSell}
          onActiveSeasonChange={handleActiveSeasonChange}
          isVerified={isVerified}
          isGated={isActiveGated}
          onVerify={handleVerifyActive}
          isConnected={isConnected}
          onConnect={handleConnect}
          isFarcaster={isFarcaster}
          showMineOnly={showMineOnly}
          onToggleMine={handleToggleMine}
        />
```

- [ ] **Step 6: Run RaffleList tests to verify no regression**

Run: `cd packages/frontend && npx vitest run src/routes/__tests__/raffleListBuckets.test.jsx src/routes/__tests__/RaffleList.urlTabSync.test.jsx`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/mobile/MobileRafflesList.jsx packages/frontend/src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx packages/frontend/src/routes/RaffleList.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): four-tab status grouping in MobileRafflesList (#101)

Brings the desktop 4-tab raffle grouping (Upcoming/Active/Settling/
Complete) to mobile via the existing shadcn Tabs primitive. RaffleList
now passes `grouped`/`activeTab`/`onTabChange` to mobile and drops the
mobile-only `mobileSeasons` flat filter — the unified `grouped`
demotion path (PR #99 spoiler hold) now applies to both surfaces, so
unseen completed raffles surface in the Settling tab on mobile too
instead of vanishing entirely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend celebration-hold test to cover mobile demotion

The existing `RaffleList.celebrationHold.test.jsx` only covers desktop demotion. Add a case verifying that on mobile, an unseen Completed season surfaces in the Settling group (via `grouped`), and then promotes to Complete after `seenSet` records the visit.

**Files:**
- Modify: `packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx`

- [ ] **Step 1: Read the existing celebration-hold test**

Run: `cat packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx | head -60`
Note the existing mock for `usePlatform`, `useFirstViewGateBatch`, and the seasons fixture.

- [ ] **Step 2: Add the mobile demotion case**

In `packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx`, find the `usePlatform` mock and switch it to a `vi.fn()` you can override per-test:

Find:
```jsx
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: false, isFarcaster: false }),
}));
```

Replace with:
```jsx
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: vi.fn(() => ({ isMobile: false, isFarcaster: false })),
}));
```

Then import the mock at the top of the file (alongside other imports):
```jsx
import { usePlatform } from '@/hooks/usePlatform';
```

Replace the existing `MobileRafflesList` mock to capture the props it receives so the test can assert on what mobile got passed:
```jsx
const mobileCalls = [];
vi.mock('@/components/mobile/MobileRafflesList', () => ({
  default: (props) => {
    mobileCalls.push(props);
    return <div data-testid="mobile-list" />;
  },
}));
```

If `mobileCalls` already exists, leave it alone — just adapt the mock signature.

At the bottom of the existing `describe` block, add:

```jsx
  describe('mobile demotion (unified with desktop)', () => {
    beforeEach(() => {
      mobileCalls.length = 0;
      vi.mocked(usePlatform).mockReturnValue({ isMobile: true, isFarcaster: false });
    });

    it('demotes unseen completed seasons into the settling group on mobile', () => {
      // Default useFirstViewGateBatch mock returns empty Set => no seasons seen.
      // The completed Season 4 (status 5) should show up in grouped.settling.
      renderRaffleList(); // uses the existing render helper from this file

      const lastCall = mobileCalls[mobileCalls.length - 1];
      const settlingIds = lastCall.grouped.settling.map((entry) => entry.season.id);
      const completeIds = lastCall.grouped.complete.map((entry) => entry.season.id);

      expect(settlingIds).toContain(4); // demoted unseen completed
      expect(completeIds).not.toContain(4);

      // suppressWinner should be true for the demoted status-5 entry
      const demoted = lastCall.grouped.settling.find((entry) => entry.season.id === 4);
      expect(demoted?.suppressWinner).toBe(true);
    });

    it('promotes to complete once seenSet records the visit', () => {
      // Override useFirstViewGateBatch to mark season 4 as seen
      const useFirstViewGate = require('@/hooks/useFirstViewGate');
      vi.spyOn(useFirstViewGate, 'useFirstViewGateBatch').mockReturnValue(new Set(['4']));

      renderRaffleList();

      const lastCall = mobileCalls[mobileCalls.length - 1];
      const settlingIds = lastCall.grouped.settling.map((entry) => entry.season.id);
      const completeIds = lastCall.grouped.complete.map((entry) => entry.season.id);

      expect(completeIds).toContain(4);
      expect(settlingIds).not.toContain(4);
    });
  });
```

If the existing file doesn't have a `renderRaffleList` helper, adapt to whatever render pattern it uses (e.g., inline `render(<RaffleList />, ...)` with the existing providers).

- [ ] **Step 3: Run the celebration-hold test**

Run: `cd packages/frontend && npx vitest run src/routes/__tests__/RaffleList.celebrationHold.test.jsx`
Expected: all tests PASS, including the 2 new mobile cases.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx
git commit -m "$(cat <<'EOF'
test(frontend): cover mobile demotion in celebration-hold suite (#101)

Mobile now receives the unified `grouped` object (PR #101) instead of a
flat list, so unseen completed raffles demote to the Settling group on
mobile just like desktop. Tests verify the demote-then-promote flow
matches desktop behavior after seenSet records the visit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Version bump + full verification

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 1: Bump frontend version**

In `packages/frontend/package.json`, change:
```json
  "version": "0.41.3",
```
to:
```json
  "version": "0.42.0",
```
(Minor bump per semver — this is a `feat`.)

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd packages/frontend && npx vitest run`
Expected: all tests PASS (count should be previous total + 11 new cases from this PR's 5+4+2 additions).

- [ ] **Step 3: Lint touched files**

Run: `cd packages/frontend && npx eslint src/routes/RaffleList.jsx src/components/mobile/MobileRafflesList.jsx src/routes/__tests__/RaffleList.urlTabSync.test.jsx src/components/mobile/__tests__/MobileRafflesList.tabs.test.jsx src/routes/__tests__/RaffleList.celebrationHold.test.jsx`
Expected: no errors, no warnings.

- [ ] **Step 4: Commit and push, open PR**

```bash
git add packages/frontend/package.json
git commit -m "$(cat <<'EOF'
chore(frontend): bump to 0.42.0 for mobile raffle status tabs (#101)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin feat/mobile-raffle-status-tabs

gh pr create --title "feat(frontend): mobile raffle status tabs (#101)" --body "$(cat <<'EOF'
Closes #101.

## Summary
- Brings the desktop 4-tab raffle status grouping (Upcoming/Active/Settling/Complete) to `MobileRafflesList` using the existing shadcn `<Tabs>` primitive (already pill-styled with sliding indicator).
- Unifies the active-tab persistence story across desktop, mobile browser, and Farcaster MiniApp via a `?tab=<group>` URL param. Deep-linkable from notifications and shared links; invalid values fall back to `"active"`.
- Removes the mobile-only `mobileSeasons` flat-filter (PR #99 workaround). Mobile now uses the same `grouped` object as desktop, so unseen Completed raffles demote to Settling (winner suppressed) instead of vanishing entirely.
- Bumps frontend `0.41.3` → `0.42.0`.

## Test plan
- [x] New: `RaffleList.urlTabSync.test.jsx` — URL sync behavior (4 cases).
- [x] New: `MobileRafflesList.tabs.test.jsx` — tab rendering, count chips, empty state, gating-contract preservation (5 cases).
- [x] Extended: `RaffleList.celebrationHold.test.jsx` — mobile demote-then-promote (2 cases).
- [x] Full frontend suite passes.
- [x] ESLint clean on touched files.
- [ ] Smoke in a Farcaster MiniApp preview (Vercel preview env): tabs render, count chips correct, switching tabs updates `?tab=` in URL, carousel jumps to index 0 on switch.
- [ ] Smoke in desktop browser: existing tabs still work, URL now syncs with `?tab=`.

Spec: `docs/superpowers/specs/2026-05-23-mobile-raffle-status-tabs-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

- **Spec coverage:**
  - URL `?tab=` sync → Task 1.
  - Mobile 4-tab UI with pill triggers and count chips → Task 2.
  - PR #99 spoiler-hold unification (mobile uses `grouped`, not `mobileSeasons`) → Task 2.
  - Empty state per group → Task 2 (uses `raffle.emptyTab.<group>` i18n).
  - `onActiveSeasonChange` contract preserved → Task 2 (verified by test in step 1).
  - Tests for URL sync, mobile tabs, mobile demotion → Tasks 1, 2, 3.
  - Version bump → Task 4.
  - All spec items covered.

- **Placeholder scan:** no "TBD"/"TODO"/"implement later" in the plan. All test code, implementation code, and commands are concrete.

- **Type consistency:** prop names (`grouped`, `activeTab`, `onTabChange`), the four group keys (`upcoming`/`active`/`settling`/`complete`), and the `{ season, suppressWinner }` entry shape are consistent across RaffleList, MobileRafflesList, and the test files. `setActiveTab` is the callback name; mobile receives it as `onTabChange`. `VALID_TABS` (RaffleList) and `TAB_KEYS` (MobileRafflesList) hold the same array — slight naming divergence is intentional (different scope).

- **Spec ↔ plan ambiguity:** the spec mentions card-height auto-shrink via `cardRef.current.getBoundingClientRect().top`; the plan adds `activeTab` to the height-effect dependency list so the measurement re-runs after tab swaps. This is a small refinement, not a deviation.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-23-mobile-raffle-status-tabs.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
