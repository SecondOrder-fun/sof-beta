# Raffle List Design Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the desktop `/raffles` list with a 4-tab grouping (Upcoming / Active / Settling / Complete), per-tab card variants, and close an existing curve/price-leak bug on EndRequested/VRFPending cards.

**Architecture:** Extract the inline `ActiveSeasonCard` (from `RaffleList.jsx`) into a new `SeasonCard` component. Bucket seasons into 4 status groups in the route, render via existing `Tabs` component with count badges composed inside each `TabsTrigger`. Per-tab card variants live inside `SeasonCard` keyed off a `statusGroup` prop. New `TimeElapsed` common component for the "Locked X min ago" indicator on Settling cards.

**Tech Stack:** React, vitest, Tailwind (theme tokens via CSS variables), `@/components/ui/tabs` (existing Radix wrapper), `@/components/ui/badge`, `react-i18next`.

**Spec:** `docs/superpowers/specs/2026-05-10-raffle-list-design-upgrade-design.md`

**Branches (sequential, never parallel):**
1. `feat/raffle-list-tabs` — tab structure + extract `SeasonCard` (no card-body changes)
2. `feat/raffle-list-settling-card` — Settling card variant + close curve/price leak
3. `feat/raffle-list-complete-cleanup` — Cancelled card variant + verification

Each branch ends with: `npm run lint` clean, `npm test` green, preview env up via `pr-preview.yml`. Each follows `github-pr-workflow` Phases 1–4 (fetch + branch from `origin/main`; push + open PR at first meaningful commit; cleanup on merge).

---

## Branch 1 — `feat/raffle-list-tabs`

**Branch start checklist:**
- [ ] **B1.0** — Confirm on `feat/raffle-list-tabs` (already created in this session). Verify with `git rev-parse --abbrev-ref HEAD`. If missing, `git fetch origin && git checkout -b feat/raffle-list-tabs origin/main`.

### Task 1: Extract `SeasonCard` from `RaffleList.jsx`

**Files:**
- Create: `packages/frontend/src/components/raffles/SeasonCard.jsx`
- Modify: `packages/frontend/src/routes/RaffleList.jsx` (remove inline `ActiveSeasonCard`; import the new file)
- Test: `packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx`

The behavior of the card stays identical to today's `ActiveSeasonCard`. We're moving code, not changing it.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { SeasonCard } from '../SeasonCard';

// Mock hooks the card depends on
vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => ({ curveSupply: 0n, curveStep: { price: 0n }, allBondSteps: [] }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));
vi.mock('@/components/curve/CurveGraph', () => ({
  default: () => <div data-testid="curve-mini" />,
}));
vi.mock('@/components/common/CountdownTimer', () => ({
  default: ({ targetTimestamp }) => <span data-testid="countdown">{String(targetTimestamp)}</span>,
}));
vi.mock('@/components/user/UsernameDisplay', () => ({
  default: ({ address }) => <span>{address}</span>,
}));

const noopBadge = (status) => <span data-testid="badge">{status}</span>;

describe('SeasonCard', () => {
  it('renders id, name, and status badge in the header', () => {
    const season = {
      id: 1,
      status: 1,
      totalTickets: 0n,
      config: { name: 'Test', startTime: 1000n, endTime: 2000n, bondingCurve: '0xabc' },
    };
    render(
      <MemoryRouter>
        <SeasonCard season={season} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Test/)).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toHaveTextContent('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && npx vitest run src/components/raffles/__tests__/SeasonCard.test.jsx
```

Expected: FAIL with "Cannot find module '../SeasonCard'".

- [ ] **Step 3: Create `SeasonCard.jsx` by lifting `ActiveSeasonCard` verbatim**

Move the entire `ActiveSeasonCard` function definition (lines 29–204 in current `RaffleList.jsx`) into `packages/frontend/src/components/raffles/SeasonCard.jsx`. Rename the export from `ActiveSeasonCard` to `SeasonCard`. Update the import paths inside the new file to use `@/` aliases. Add the named export `export { SeasonCard };` at the bottom (the test uses a named import).

Imports to keep at the top of `SeasonCard.jsx`:

```jsx
import PropTypes from "prop-types";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatUnits } from "viem";
import { useCurveState } from "@/hooks/useCurveState";
import BondingCurvePanel from "@/components/curve/CurveGraph";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CountdownTimer from "@/components/common/CountdownTimer";
import UsernameDisplay from "@/components/user/UsernameDisplay";
```

Body of `SeasonCard` is identical to current `ActiveSeasonCard` — DO NOT change the rendering logic in this task.

- [ ] **Step 4: Modify `RaffleList.jsx` to import and use `SeasonCard`**

Remove lines 29–204 of `RaffleList.jsx` (the `ActiveSeasonCard` definition + its `propTypes`). Add at the imports block:

```jsx
import { SeasonCard } from "@/components/raffles/SeasonCard";
```

Replace the desktop-render `<ActiveSeasonCard ... />` (around line 495) with `<SeasonCard ... />` — same props.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/frontend && npx vitest run src/components/raffles/__tests__/SeasonCard.test.jsx
```

Expected: PASS.

Then run the full suite:
```bash
cd packages/frontend && npm test --silent
```

Expected: 347/347 passing (one new test added; existing 346 still pass).

- [ ] **Step 6: Lint**

```bash
cd packages/frontend && npm run lint
```

Expected: zero warnings.

- [ ] **Step 7: Commit and push**

```bash
git add packages/frontend/src/components/raffles/SeasonCard.jsx \
        packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx \
        packages/frontend/src/routes/RaffleList.jsx
git commit -m "refactor(frontend): extract SeasonCard from RaffleList (no behavior change)

Pure move + rename. ActiveSeasonCard inline in RaffleList.jsx → SeasonCard
in components/raffles/. Same props, same render. Lifts the file from
500+ lines to ~300, sets up subsequent tab + variant work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

The push triggers the existing draft PR #77's preview rebuild.

---

### Task 2: Bucket seasons by status group

**Files:**
- Modify: `packages/frontend/src/routes/RaffleList.jsx`

Add a pure utility that maps a season to its tab group name. Pre-cursor for the tab structure.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/routes/__tests__/raffleListBuckets.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { getSeasonGroup } from '../RaffleList';

describe('getSeasonGroup', () => {
  it('maps NotStarted (0) to upcoming', () => {
    expect(getSeasonGroup(0)).toBe('upcoming');
  });
  it('maps Active (1) to active', () => {
    expect(getSeasonGroup(1)).toBe('active');
  });
  it('maps EndRequested (2) to settling', () => {
    expect(getSeasonGroup(2)).toBe('settling');
  });
  it('maps VRFPending (3) to settling', () => {
    expect(getSeasonGroup(3)).toBe('settling');
  });
  it('maps Distributing (4) to settling', () => {
    expect(getSeasonGroup(4)).toBe('settling');
  });
  it('maps Completed (5) to complete', () => {
    expect(getSeasonGroup(5)).toBe('complete');
  });
  it('maps Cancelled (6) to complete', () => {
    expect(getSeasonGroup(6)).toBe('complete');
  });
  it('falls back to active for unknown values', () => {
    expect(getSeasonGroup(99)).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && npx vitest run src/routes/__tests__/raffleListBuckets.test.js
```

Expected: FAIL — `getSeasonGroup is not a function`.

- [ ] **Step 3: Add `getSeasonGroup` to `RaffleList.jsx`**

In `RaffleList.jsx` near the top of the file (after imports, before the `RaffleList` component), add:

```jsx
/**
 * Map an on-chain SeasonStatus enum value to its tab group name.
 * Spec: docs/superpowers/specs/2026-05-10-raffle-list-design-upgrade-design.md
 */
export function getSeasonGroup(statusNum) {
  const n = Number(statusNum);
  if (n === 0) return "upcoming";
  if (n === 1) return "active";
  if (n === 2 || n === 3 || n === 4) return "settling";
  if (n === 5 || n === 6) return "complete";
  return "active";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && npx vitest run src/routes/__tests__/raffleListBuckets.test.js
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit and push**

```bash
git add packages/frontend/src/routes/RaffleList.jsx \
        packages/frontend/src/routes/__tests__/raffleListBuckets.test.js
git commit -m "feat(frontend): add getSeasonGroup status→tab mapping (raffle list)

Pure function; tested. Maps all 7 SeasonStatus enum values to one of
4 tab groups (upcoming / active / settling / complete) per spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

### Task 3: Add tab i18n keys

**Files:**
- Modify: `packages/frontend/public/locales/en/raffle.json` (and any other locale files that mirror `en/`)

- [ ] **Step 1: Identify locale files to update**

```bash
ls /Users/psd/Projects/SOf/sof-beta/packages/frontend/public/locales/
```

Update `en/raffle.json` for sure. If other locales (e.g. `es/`, `fr/`) have a `raffle.json`, mirror the keys there with English fallback values — translators can fix later.

- [ ] **Step 2: Add tab labels and empty-state copy to `en/raffle.json`**

Insert (alphabetized within the file's existing structure):

```json
"tabs": {
  "upcoming": "Upcoming",
  "active": "Active",
  "settling": "Settling",
  "complete": "Complete"
},
"emptyTab": {
  "upcoming": "No upcoming raffles.",
  "active": "No active raffles right now.",
  "settling": "Nothing settling.",
  "complete": "No completed raffles yet."
}
```

If there are existing `noActiveSeasons`-style keys, leave them in place — unused keys are removed in a separate cleanup branch later.

- [ ] **Step 3: Lint to verify JSON is valid**

```bash
cd packages/frontend && npm run lint
```

Expected: zero warnings (ESLint catches JSON syntax errors via the editor; if not, run `node -e "require('./public/locales/en/raffle.json')"` to verify parse).

- [ ] **Step 4: Commit and push**

```bash
git add packages/frontend/public/locales/en/raffle.json
git commit -m "feat(frontend): add raffle list tab i18n keys

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

### Task 4: Render the tab strip with count badges

**Files:**
- Modify: `packages/frontend/src/routes/RaffleList.jsx`

This is the visual change — replaces the single grid with a 4-tab `Tabs` structure.

- [ ] **Step 1: Write the failing integration test**

Append to `packages/frontend/src/routes/__tests__/raffleListBuckets.test.js`:

```javascript
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RaffleList from '../RaffleList';

// Hoist mocks
import { vi } from 'vitest';

vi.mock('@/hooks/useAllSeasons', () => ({
  useAllSeasons: () => ({
    data: [
      { id: 1, status: 0, totalTickets: 0n, config: { name: 'Up', startTime: 0n, endTime: 0n, bondingCurve: '0xa' } },
      { id: 2, status: 1, totalTickets: 0n, config: { name: 'Act', startTime: 0n, endTime: 0n, bondingCurve: '0xb' } },
      { id: 3, status: 3, totalTickets: 0n, config: { name: 'Set', startTime: 0n, endTime: 0n, bondingCurve: '0xc' } },
      { id: 4, status: 5, totalTickets: 0n, config: { name: 'Done', startTime: 0n, endTime: 0n, bondingCurve: '0xd' } },
      { id: 5, status: 5, totalTickets: 0n, config: { name: 'Done2', startTime: 0n, endTime: 0n, bondingCurve: '0xe' } },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummaries: () => ({ data: {} }),
}));
vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ isMobile: false, isFarcaster: false }) }));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false, chainId: 84532 }),
  useChains: () => [],
}));
vi.mock('@/hooks/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: () => {} }) }));
vi.mock('@/hooks/useRaffleAccount', () => ({ useRaffleAccount: () => ({ sma: undefined }) }));
vi.mock('@/hooks/useProfileData', () => ({ useProfileData: () => ({ seasonBalancesQuery: { data: undefined } }) }));
vi.mock('@/hooks/useSeasonGating', () => ({
  useSeasonGating: () => ({ isVerified: undefined, verifyPassword: () => {}, verifySignature: () => {}, gates: [], refetch: () => {} }),
  GateType: { PASSWORD: 0, SIGNATURE: 1 },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

describe('RaffleList tabs', () => {
  it('renders 4 tabs with correct counts', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RaffleList />
        </MemoryRouter>
      </QueryClientProvider>
    );
    // Tab labels (translation key falls through as the value due to mock)
    expect(screen.getByRole('tab', { name: /tabs.upcoming/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tabs.active/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tabs.settling/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tabs.complete/ })).toBeInTheDocument();
    // Counts: 1 upcoming, 1 active, 1 settling, 2 complete
    const upcomingTab = screen.getByRole('tab', { name: /tabs.upcoming/ });
    expect(upcomingTab.textContent).toMatch(/1/);
    const completeTab = screen.getByRole('tab', { name: /tabs.complete/ });
    expect(completeTab.textContent).toMatch(/2/);
  });

  it('Active tab is active by default', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RaffleList />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const activeTab = screen.getByRole('tab', { name: /tabs.active/ });
    expect(activeTab).toHaveAttribute('data-state', 'active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && npx vitest run src/routes/__tests__/raffleListBuckets.test.js
```

Expected: FAIL — no tabs rendered yet.

- [ ] **Step 3: Add Tabs + count badges to `RaffleList.jsx` desktop branch**

Add the Tabs import near the existing UI imports (the file already imports `Badge` and `useMemo` — don't duplicate):

```jsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

Inside the desktop `RaffleList` return (the block starting `// Desktop view`), replace the single grid section (around line 481–502) with a tabbed structure. The grouping logic uses `getSeasonGroup`:

```jsx
const grouped = useMemo(() => {
  const buckets = { upcoming: [], active: [], settling: [], complete: [] };
  for (const s of displayedSeasons) {
    const g = getSeasonGroup(s.status);
    if (buckets[g]) buckets[g].push(s);
  }
  return buckets;
}, [displayedSeasons]);

// ...inside the JSX, replace the existing `<div className="grid ...">` with:

<Tabs defaultValue="active">
  <TabsList>
    {(["upcoming", "active", "settling", "complete"]).map((g) => {
      const count = grouped[g].length;
      return (
        <TabsTrigger key={g} value={g} className="flex items-center gap-2">
          <span>{t(`tabs.${g}`)}</span>
          <span className="rounded-full px-2 text-xs font-semibold leading-5
                           bg-secondary text-secondary-foreground
                           [[data-state=active]_&]:bg-background
                           [[data-state=active]_&]:text-primary">
            {count}
          </span>
        </TabsTrigger>
      );
    })}
  </TabsList>

  {(["upcoming", "active", "settling", "complete"]).map((g) => (
    <TabsContent key={g} value={g}>
      {grouped[g].length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          {t(`emptyTab.${g}`)}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {grouped[g].map((season) => (
            <SeasonCard
              key={season.id}
              season={season}
              renderBadge={renderBadge}
              winnerSummary={winnerSummariesQuery.data?.[season.id]}
            />
          ))}
        </div>
      )}
    </TabsContent>
  ))}
</Tabs>
```

**About the count-badge active-state styling:** The arbitrary variant `[[data-state=active]_&]:` matches when *any ancestor* has `data-state="active"`. Radix's `TabsPrimitive.Trigger` sets that attribute on the active trigger; the count badge `<span>` is a descendant. So the badge automatically flips from `bg-secondary text-secondary-foreground` (pastel rose pill, black text) to `bg-background text-primary` (white pill, primary-red text) when its parent trigger is active. Pure CSS, no `Badge` component import, no JS state coordination.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/frontend && npx vitest run src/routes/__tests__/raffleListBuckets.test.js
```

Expected: PASS.

Then run the full suite:
```bash
cd packages/frontend && npm test --silent
```

Expected: 350/350 (3 tests added across this branch).

- [ ] **Step 5: Lint**

```bash
cd packages/frontend && npm run lint
```

Expected: zero warnings.

- [ ] **Step 6: Visual check on preview env**

Open the PR's Vercel preview URL (linked in PR #77's checks). Verify:
1. Tabs render across the top
2. Active is selected by default
3. Count badges show correct numbers per tab
4. Inactive tab badges look like the secondary pill (pastel rose, black text)
5. Active tab badge is a white pill with cochineal-red text
6. Clicking each tab shows the bucketed cards
7. Empty tab shows the empty-state copy
8. The "My Raffles" toggle still works and counts adjust accordingly

- [ ] **Step 7: Commit, push, un-draft the PR**

```bash
git add packages/frontend/src/routes/RaffleList.jsx \
        packages/frontend/src/routes/__tests__/raffleListBuckets.test.js
git commit -m "feat(frontend): tab grouping for raffle list (Upcoming/Active/Settling/Complete)

- Bucket displayedSeasons by getSeasonGroup
- Render with existing Tabs component, no tabs.jsx changes
- Count badges composed inside each TabsTrigger
- Active trigger badge: white pill, primary text via [[data-state=active]_&] variant
- Empty-state copy per tab
- 'My Raffles' toggle filters globally, counts reflect filtered set

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

Then mark PR #77 ready for review:
```bash
gh pr ready 77
```

- [ ] **Step 8: Bump frontend version**

```bash
# Edit packages/frontend/package.json: 0.29.0 → 0.30.0 (minor: new feature surface)
git add packages/frontend/package.json
git commit -m "chore(frontend): bump version to 0.30.0 (raffle list tabs)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

**Branch 1 done.** PR #77 is now ready for user review/merge.

---

## Branch 2 — `feat/raffle-list-settling-card`

**Branch start checklist:**

- [ ] **B2.0** — Wait for PR #77 to merge into main. Then:

```bash
git fetch origin
git checkout -b feat/raffle-list-settling-card origin/main
```

(`github-pr-workflow` Phase 1.)

### Task 5: Add `statusSettling` badge variant

**Files:**
- Modify: `packages/frontend/src/components/ui/badge.jsx`

- [ ] **Step 1: Read current badge.jsx**

```bash
cat packages/frontend/src/components/ui/badge.jsx
```

Note the existing variants: `statusActive`, `statusCompleted`, `statusUpcoming`, `statusDanger`. Their styling pattern (find one of them in the file).

- [ ] **Step 2: Add `statusSettling` variant**

In `badge.jsx`, in the `variant` enum object (around line 25), after `statusUpcoming`, add:

```jsx
statusSettling:
  "bg-warning/15 text-warning hover:bg-warning/15 border border-warning/30",
```

…matching the styling shape used by the other status variants. Adjust to match existing patterns exactly (read one neighbor first to mirror the format).

In the `propTypes` `variant` enum (around line 60), add `"statusSettling"` to the array of allowed values.

- [ ] **Step 3: Lint**

```bash
cd packages/frontend && npm run lint
```

Expected: zero warnings.

- [ ] **Step 4: Commit and push**

```bash
git add packages/frontend/src/components/ui/badge.jsx
git commit -m "feat(frontend): add statusSettling badge variant

Warning-tinted (--warning) for in-flight raffle states (EndRequested,
VRFPending, Distributing). Matches existing status* variant family.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

(First push will need `-u origin feat/raffle-list-settling-card` — opens the next draft PR via `gh pr create --draft` immediately after — see Task 6's commit step.)

### Task 6: Build the `TimeElapsed` component

**Files:**
- Create: `packages/frontend/src/components/common/TimeElapsed.jsx`
- Test: `packages/frontend/src/components/common/__tests__/TimeElapsed.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/common/__tests__/TimeElapsed.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TimeElapsed from '../TimeElapsed';

describe('TimeElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders "just now" within first minute', () => {
    const t = Math.floor(new Date('2026-05-10T11:59:30Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
  });

  it('renders "X min ago" between 1 and 60 minutes', () => {
    const t = Math.floor(new Date('2026-05-10T11:55:00Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/5 min ago/i)).toBeInTheDocument();
  });

  it('renders "X hr ago" between 1 and 24 hours', () => {
    const t = Math.floor(new Date('2026-05-10T09:00:00Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/3 hr ago/i)).toBeInTheDocument();
  });

  it('renders "X day ago" beyond 24 hours', () => {
    const t = Math.floor(new Date('2026-05-08T12:00:00Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/2 days ago/i)).toBeInTheDocument();
  });

  it('returns null for missing or invalid timestamps', () => {
    const { container } = render(<TimeElapsed targetTimestamp={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('refreshes every 30s', () => {
    const t = Math.floor(new Date('2026-05-10T11:59:30Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText(/1 min ago/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && npx vitest run src/components/common/__tests__/TimeElapsed.test.jsx
```

Expected: FAIL — `Cannot find module '../TimeElapsed'`.

- [ ] **Step 3: Implement `TimeElapsed.jsx`**

```jsx
import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const REFRESH_MS = 30_000;

function formatElapsed(seconds) {
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function TimeElapsed({ targetTimestamp, className }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const t = Number(targetTimestamp);
  if (!Number.isFinite(t) || t <= 0) return null;
  const diff = Math.max(0, now - t);
  return <span className={className}>{formatElapsed(diff)}</span>;
}

TimeElapsed.propTypes = {
  targetTimestamp: PropTypes.oneOfType([PropTypes.number, PropTypes.bigint, PropTypes.string]),
  className: PropTypes.string,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && npx vitest run src/components/common/__tests__/TimeElapsed.test.jsx
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit and push (first push opens the draft PR)**

```bash
git add packages/frontend/src/components/common/TimeElapsed.jsx \
        packages/frontend/src/components/common/__tests__/TimeElapsed.test.jsx
git commit -m "feat(frontend): TimeElapsed component for 'X min ago' indicators

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feat/raffle-list-settling-card

# Open draft PR (github-pr-workflow Phase 2)
gh pr create --draft --title "feat(frontend): raffle list — Settling card variant (branch 2 of 3)" --body "Branch 2 of 3 in the raffle list design upgrade. Spec: docs/superpowers/specs/2026-05-10-raffle-list-design-upgrade-design.md. Plan: docs/superpowers/plans/2026-05-10-raffle-list-design-upgrade.md.

## Summary
- New Settling card variant for statuses 2 (EndRequested), 3 (VRFPending), 4 (Distributing)
- Status pill + 'Trading locked / X min ago' indicator
- Closes the existing leak where status 2/3 cards show curve+'Current Price'+Buy/Sell while trading is actually locked
- New \`TimeElapsed\` component
- New \`statusSettling\` badge variant

## Test plan
- [ ] All existing tests pass
- [ ] New TimeElapsed tests pass (6)
- [ ] Preview env: status 4 (Distributing) cards show settling indicator
- [ ] Preview env: status 5 (Completed) cards still show winner box
- [ ] Preview env: status 1 (Active) cards still show curve+price+Buy/Sell

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

### Task 7: Refactor `SeasonCard` body to per-status branches

**Files:**
- Modify: `packages/frontend/src/components/raffles/SeasonCard.jsx`
- Modify: `packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx`

This is the meat of branch 2. We replace the coarse `isCompleted = (4 || 5)` gate with precise per-status branching, and add the Settling body.

- [ ] **Step 1: Add tests for the new behavior**

Append to `SeasonCard.test.jsx`:

```jsx
describe('SeasonCard variants', () => {
  const baseSeason = (status) => ({
    id: 1,
    status,
    totalTickets: 0n,
    config: { name: 'T', startTime: 0n, endTime: 1700000000n, bondingCurve: '0xa' },
  });

  it('Active status renders curve + Current Price + Buy/Sell', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(1)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('curve-mini')).toBeInTheDocument();
    expect(screen.getByText(/currentPrice/i)).toBeInTheDocument();
    expect(screen.getByText(/common:buy/i)).toBeInTheDocument();
  });

  it('Settling status (3 = VRFPending) hides curve and price, shows time-elapsed', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(3)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    expect(screen.queryByText(/currentPrice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/common:buy/i)).not.toBeInTheDocument();
    expect(screen.getByText(/tradingLocked/i)).toBeInTheDocument();
  });

  it('Settling status 2 hides curve and price', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(2)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
  });

  it('Settling status 4 hides curve and price', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(4)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
  });

  it('Completed status (5) with winner shows winner box, no curve, no price', () => {
    render(
      <MemoryRouter>
        <SeasonCard
          season={baseSeason(5)}
          renderBadge={noopBadge}
          winnerSummary={{ winnerAddress: '0xwinner', grandPrizeWei: 1000000000000000000n }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    expect(screen.getByText(/winner/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd packages/frontend && npx vitest run src/components/raffles/__tests__/SeasonCard.test.jsx
```

Expected: 4 of the 5 new tests fail (the Active one passes; Settling/Completed-without-curve fail because today's gate is too coarse).

- [ ] **Step 3: Refactor `SeasonCard.jsx` body**

In `SeasonCard.jsx`, replace the `const isCompleted = statusNum === 4 || statusNum === 5;` line and the conditional rendering blocks with precise gates and a new Settling branch.

Add at the top of the component, right after `statusNum`:

```jsx
const isUpcoming = statusNum === 0;
const isActive = statusNum === 1;
const isSettling = statusNum === 2 || statusNum === 3 || statusNum === 4;
const isComplete = statusNum === 5 || statusNum === 6;

const settlingLabelKey =
  statusNum === 2 ? "settlingAwaitingEnd" :
  statusNum === 3 ? "settlingDrawingWinner" :
  statusNum === 4 ? "settlingDistributing" : null;
```

Replace the JSX body (everything after `<CardHeader>` until the close of `<CardContent>`) with:

```jsx
<CardContent className="flex flex-col gap-2 pt-0">
  {isActive && (
    <>
      <div className="overflow-hidden rounded-md bg-muted/40">
        <div className="h-44">
          <BondingCurvePanel
            curveSupply={curveSupply}
            curveStep={curveStep}
            allBondSteps={allBondSteps}
            mini
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="text-xs text-primary">{t("currentPrice")}</div>
          <div className="font-mono text-base">{currentPriceLabel} SOF</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => navigate(`/raffles/${season.id}?mode=buy`)}>
            {t("common:buy")}
          </Button>
          <Button size="sm" onClick={() => navigate(`/raffles/${season.id}?mode=sell`)}>
            {t("common:sell")}
          </Button>
        </div>
      </div>
    </>
  )}

  {isUpcoming && (
    <>
      <div className="overflow-hidden rounded-md bg-muted/40">
        <div className="h-44">
          <BondingCurvePanel
            curveSupply={curveSupply}
            curveStep={curveStep}
            allBondSteps={allBondSteps}
            mini
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="text-xs text-primary">{t("startingPrice", { defaultValue: "Starting Price (SOF)" })}</div>
          <div className="font-mono text-base">{currentPriceLabel} SOF</div>
        </div>
      </div>
    </>
  )}

  {isSettling && (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-center">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {t("tradingLocked", { defaultValue: "Trading locked" })}
      </div>
      <div className="font-mono text-base text-foreground mt-1">
        <TimeElapsed targetTimestamp={Number(season?.config?.endTime)} />
      </div>
      {settlingLabelKey && (
        <div className="mt-2 text-xs text-muted-foreground">
          {t(settlingLabelKey)}
        </div>
      )}
    </div>
  )}

  {isComplete && winnerSummary && (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-base text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm uppercase tracking-wide text-primary">{t("winner")}</span>
        <span className="text-lg font-semibold text-foreground">
          <UsernameDisplay address={winnerSummary.winnerAddress} className="text-lg" />
        </span>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {t("grandPrize")}:{" "}
        {(() => {
          try {
            return `${Number(formatUnits(winnerSummary.grandPrizeWei, 18)).toFixed(2)} SOF`;
          } catch {
            return "0.00 SOF";
          }
        })()}
      </div>
    </div>
  )}

  {isComplete && !winnerSummary && totalTickets === 0n && (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-base text-muted-foreground">
      <div className="text-sm font-semibold text-foreground">{t("noWinner")}</div>
      <div className="mt-2 text-sm text-muted-foreground">{t("noParticipants")}</div>
    </div>
  )}
</CardContent>
```

Add the `TimeElapsed` import at the top:

```jsx
import TimeElapsed from "@/components/common/TimeElapsed";
```

The header's countdown logic (pre-start "starts in" / active "ends in") is already gated correctly — leave it alone.

- [ ] **Step 4: Add Settling i18n keys**

Append to `packages/frontend/public/locales/en/raffle.json`:

```json
"tradingLocked": "Trading locked",
"settlingAwaitingEnd": "Awaiting end",
"settlingDrawingWinner": "Drawing winner",
"settlingDistributing": "Distributing prizes"
```

- [ ] **Step 5: Run tests to verify all pass**

```bash
cd packages/frontend && npm test --silent
```

Expected: 355/355 (5 new tests added across this task).

- [ ] **Step 6: Lint**

```bash
cd packages/frontend && npm run lint
```

Expected: zero warnings.

- [ ] **Step 7: Visual check on preview env**

Open the PR's preview URL. Verify:
1. Status 1 (Active) cards still show curve + "Current Price" + Buy/Sell
2. Status 2/3/4 (Settling) cards show "Trading locked" + "X min ago" + per-status sub-label
3. Status 0 (Upcoming) cards show curve + "Starting Price"
4. Status 5 (Completed) cards show winner box (or no-winner box)
5. No curve / no price on Settling cards (the bug is closed)

- [ ] **Step 8: Commit, push, un-draft**

```bash
git add packages/frontend/src/components/raffles/SeasonCard.jsx \
        packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx \
        packages/frontend/public/locales/en/raffle.json
git commit -m "feat(frontend): Settling card variant + close curve/price leak

- Refactor SeasonCard from coarse isCompleted=(4||5) to precise
  isUpcoming/isActive/isSettling/isComplete gates
- Add Settling body for statuses 2/3/4: status pill + 'Trading locked / X min ago'
- TimeElapsed component renders the elapsed indicator
- Hide curve+price+Buy/Sell on Settling cards (closes the existing leak
  where status 2/3 cards rendered as if still active)
- New i18n keys: tradingLocked, settling{AwaitingEnd,DrawingWinner,Distributing}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
gh pr ready  # un-draft
```

- [ ] **Step 9: Bump frontend version**

```bash
# Edit packages/frontend/package.json: 0.30.0 → 0.31.0
git add packages/frontend/package.json
git commit -m "chore(frontend): bump version to 0.31.0 (settling card variant)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

**Branch 2 done.**

---

## Branch 3 — `feat/raffle-list-complete-cleanup`

**Branch start checklist:**

- [ ] **B3.0** — Wait for branch 2's PR to merge into main. Then:

```bash
git fetch origin
git checkout -b feat/raffle-list-complete-cleanup origin/main
```

### Task 8: Add Cancelled card variant for status 6

**Files:**
- Modify: `packages/frontend/src/components/raffles/SeasonCard.jsx`
- Modify: `packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx`
- Modify: `packages/frontend/public/locales/en/raffle.json`

- [ ] **Step 1: Add the failing test**

Append to `SeasonCard.test.jsx`:

```jsx
it('Cancelled status (6) shows cancelled indicator, no curve, no winner', () => {
  render(
    <MemoryRouter>
      <SeasonCard season={baseSeason(6)} renderBadge={noopBadge} winnerSummary={null} />
    </MemoryRouter>
  );
  expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
  expect(screen.queryByText(/winner/i)).not.toBeInTheDocument();
  expect(screen.getByText(/seasonCancelled/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && npx vitest run src/components/raffles/__tests__/SeasonCard.test.jsx
```

Expected: FAIL — Cancelled body not rendered yet (status 6 currently falls into the no-winner branch but doesn't show a "cancelled" message).

- [ ] **Step 3: Add the Cancelled branch in `SeasonCard.jsx`**

In `SeasonCard.jsx`, add a derived flag:

```jsx
const isCancelled = statusNum === 6;
```

Update the `isComplete` JSX block to differentiate:

```jsx
{isComplete && isCancelled && (
  <div className="rounded-md border border-border bg-muted/40 p-4 text-base text-muted-foreground">
    <div className="text-sm font-semibold text-foreground">
      {t("cancelled", { defaultValue: "Cancelled" })}
    </div>
    <div className="mt-2 text-sm text-muted-foreground">
      {t("seasonCancelled", { defaultValue: "Season cancelled. No payout." })}
    </div>
  </div>
)}

{isComplete && !isCancelled && winnerSummary && (
  /* existing winner box, unchanged */
)}

{isComplete && !isCancelled && !winnerSummary && totalTickets === 0n && (
  /* existing no-winner box, unchanged */
)}
```

- [ ] **Step 4: Add i18n keys**

Append to `en/raffle.json`:

```json
"cancelled": "Cancelled",
"seasonCancelled": "Season cancelled. No payout."
```

- [ ] **Step 5: Run all tests**

```bash
cd packages/frontend && npm test --silent
```

Expected: 356/356 (1 new test).

- [ ] **Step 6: Lint**

```bash
cd packages/frontend && npm run lint
```

Expected: zero warnings.

- [ ] **Step 7: Verify status-5 path is fully clean**

Open `SeasonCard.jsx`, search for any remaining curve/price rendering inside `isComplete` or status-5 branches. There should be NONE. The only curve render is inside `isActive` or `isUpcoming`. The only price render is inside `isActive` or `isUpcoming`. The Buy/Sell buttons are inside `isActive` only.

- [ ] **Step 8: Commit, push, open PR (Phase 2)**

```bash
git add packages/frontend/src/components/raffles/SeasonCard.jsx \
        packages/frontend/src/components/raffles/__tests__/SeasonCard.test.jsx \
        packages/frontend/public/locales/en/raffle.json
git commit -m "feat(frontend): Cancelled card variant + Complete tab verification

- Status 6 cards render 'Cancelled' / 'Season cancelled. No payout.' indicator
  instead of falling into the no-winner branch
- Confirms status 5 winner card is fully clean (no curve, no price, no Buy/Sell)
  per spec — branch 2's gate refactor already enforces this

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feat/raffle-list-complete-cleanup

gh pr create --title "feat(frontend): raffle list — Cancelled card variant (branch 3 of 3)" --body "Branch 3 of 3 in the raffle list design upgrade. Final cleanup: Cancelled (status 6) variant + verification that status 5 (Completed) cards have no curve/price/buttons remaining.

Spec: docs/superpowers/specs/2026-05-10-raffle-list-design-upgrade-design.md
Plan: docs/superpowers/plans/2026-05-10-raffle-list-design-upgrade.md

## Test plan
- [ ] All tests pass
- [ ] Preview env: status 5 (Completed) cards show winner box only — no curve, no price, no Buy/Sell
- [ ] No live testnet raffle is currently in status 6 (Cancelled), but the variant is verified by tests

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 9: Bump frontend version**

```bash
# Edit packages/frontend/package.json: 0.31.0 → 0.31.1 (patch — small variant addition)
git add packages/frontend/package.json
git commit -m "chore(frontend): bump version to 0.31.1 (cancelled variant)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

**Branch 3 done.** All three points from the original ask are now landed across three sequential PRs.

---

## Self-Review Checklist (run before handing off to execution)

- [ ] Spec coverage: every section in `2026-05-10-raffle-list-design-upgrade-design.md` has at least one task.
- [ ] No placeholders (TBD/TODO/etc.) in any task body.
- [ ] Type / property name consistency: `getSeasonGroup`, `isUpcoming/isActive/isSettling/isComplete`, `TimeElapsed targetTimestamp`, `Tabs/TabsList/TabsTrigger/TabsContent` all used consistently.
- [ ] Branch boundaries respected: branch 1 = no card body changes; branch 2 = Settling + gate refactor + curve/price leak fix; branch 3 = Cancelled only.
- [ ] Each branch ends with: tests green, lint clean, version bump, PR open (or merged for branch boundaries), `github-pr-workflow` followed.
