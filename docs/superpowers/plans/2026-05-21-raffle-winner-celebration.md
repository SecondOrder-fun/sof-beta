# Raffle Winner Celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-time celebration modal on first-view of a completed/cancelled Raffle Detail page, with viewer-side Settling-tab hold on the Raffle List until seen.

**Architecture:** Generic `useFirstViewGate(scope, itemKey)` hook owns per-viewer localStorage with cross-tab `storage` sync. `WinnerCelebrationModal` mounts in three variants (`celebrate` / `win` / `cancelled`) on RaffleDetails first view. RaffleList demotes unseen completed/cancelled seasons from Complete bucket back to Settling via a batch variant of the same hook.

**Tech Stack:** React 18, framer-motion (already installed), `canvas-confetti` (new ~6KB dep), inline SVG for vector artwork, Vitest + React Testing Library, react-i18next, wagmi v2 `useAccount`.

**Spec:** `docs/superpowers/specs/2026-05-21-raffle-winner-celebration-design.md`

---

## Coordination with parallel admin-panel fix

A second agent is shipping an **admin panel fix** (patch bump) in parallel. To avoid stomping each other:

- **Version bump is the LAST task** (Task 11). Do not touch `packages/frontend/package.json` until then. When you reach Task 11, `git fetch origin` first and read the current `main` version: if admin has landed (e.g., main shows `0.39.12`), bump to `0.40.0` from that base. If main is still `0.39.11`, bump to `0.40.0` as planned.
- **No files in `packages/frontend/src/components/admin/`** are touched by this plan. Admin work stays there.
- **`packages/frontend/public/locales/en/raffle.json`**: we only append a new `celebration.*` block at the bottom of the existing object. If admin touches this file (unlikely — admin keys live in `common.json` / `admin.json`), resolve in the obvious additive way.
- **`packages/frontend/package.json`**: only the version field + a single new `canvas-confetti` line. If both PRs add deps, JSON merge will resolve on rebase. Run `npm install` after any rebase that touches the manifest.
- If you finish before admin lands, the PR can stay green and just rebase on top later.

---

## File Structure

**New files (all under `packages/frontend/`):**

| Path | Responsibility |
|------|----------------|
| `src/hooks/useFirstViewGate.js` | Generic per-viewer "seen X" gate (singular + batch) |
| `src/hooks/__tests__/useFirstViewGate.test.jsx` | Hook unit tests |
| `src/components/raffle/celebration/confetti.js` | `canvas-confetti` wrapper with reduced-motion bailout |
| `src/components/raffle/celebration/__tests__/confetti.test.js` | Wrapper unit tests |
| `src/components/raffle/celebration/sponsoredPrizeLabel.js` | Pure helper: derive single-line addon string |
| `src/components/raffle/celebration/__tests__/sponsoredPrizeLabel.test.js` | Helper unit tests |
| `src/components/raffle/celebration/CelebrationArtwork.jsx` | Inline SVG box+ticket+rays composition with framer-motion timeline |
| `src/components/raffle/celebration/__tests__/CelebrationArtwork.test.jsx` | Artwork rendering tests |
| `src/components/raffle/celebration/WinnerCelebrationModal.jsx` | Modal shell, variant dispatch, dismiss/timer wiring |
| `src/components/raffle/celebration/__tests__/WinnerCelebrationModal.test.jsx` | Modal behaviour tests |
| `src/routes/__tests__/RaffleList.celebrationHold.test.jsx` | List-bucket override integration |

**Modified files:**

| Path | Change |
|------|--------|
| `src/routes/RaffleDetails.jsx` | Mount `<WinnerCelebrationModal>` in completed/cancelled branch (around line 456-486) |
| `src/routes/RaffleList.jsx` | Apply per-viewer override in bucket `useMemo` (around line 245-262) |
| `src/routes/__tests__/RaffleDetails.completedBranch.test.jsx` | Pre-seed gate so existing assertions hold; add new modal-mount test |
| `public/locales/en/raffle.json` | Append `celebration.*` keys |
| `package.json` | Add `canvas-confetti`; bump version (Task 11) |

---

## Task 1: Install `canvas-confetti`

**Files:**
- Modify: `packages/frontend/package.json` (dependencies block only — NOT the `version` field)

- [ ] **Step 1: Install dep**

Run:
```bash
cd packages/frontend && npm install canvas-confetti@^1.9.3
```
Expected: `canvas-confetti` added to `dependencies` in `packages/frontend/package.json`; `package-lock.json` updated.

- [ ] **Step 2: Verify import works**

Run:
```bash
cd packages/frontend && node -e "import('canvas-confetti').then(m => console.log(typeof m.default))"
```
Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/package.json package-lock.json
git commit -m "chore(frontend): add canvas-confetti dependency"
```

---

## Task 2: `useFirstViewGate` hook — failing test

**Files:**
- Create: `packages/frontend/src/hooks/__tests__/useFirstViewGate.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/src/hooks/__tests__/useFirstViewGate.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockAddress = null;
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: mockAddress }),
}));

import {
  useFirstViewGate,
  useFirstViewGateBatch,
} from '../useFirstViewGate';

describe('useFirstViewGate', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAddress = null;
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('hasSeen is false initially', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(result.current.hasSeen).toBe(false);
  });

  it('markAsSeen flips hasSeen to true', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => result.current.markAsSeen());
    expect(result.current.hasSeen).toBe(true);
  });

  it('writes ISO timestamp under the expected key (anon viewer)', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => result.current.markAsSeen());
    const raw = localStorage.getItem('sof:firstview:celebrated:anon:42');
    expect(raw).toBeTruthy();
    expect(() => new Date(raw)).not.toThrow();
  });

  it('uses connected wallet address (lower-cased) in key', () => {
    mockAddress = '0xABCDEF0000000000000000000000000000000001';
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => result.current.markAsSeen());
    expect(
      localStorage.getItem(
        'sof:firstview:celebrated:0xabcdef0000000000000000000000000000000001:42',
      ),
    ).toBeTruthy();
  });

  it('BigInt and Number itemKeys produce the same storage key', () => {
    const { result: r1 } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => r1.current.markAsSeen());
    const { result: r2 } = renderHook(() => useFirstViewGate('celebrated', 42n));
    expect(r2.current.hasSeen).toBe(true);
  });

  it('different itemKeys are independent', () => {
    const { result: r1 } = renderHook(() => useFirstViewGate('celebrated', 1));
    const { result: r2 } = renderHook(() => useFirstViewGate('celebrated', 2));
    act(() => r1.current.markAsSeen());
    expect(r2.current.hasSeen).toBe(false);
  });

  it('different viewers are independent', () => {
    mockAddress = '0xaaa0000000000000000000000000000000000001';
    const { result: r1, rerender: rerender1 } = renderHook(() =>
      useFirstViewGate('celebrated', 42),
    );
    act(() => r1.current.markAsSeen());

    mockAddress = '0xbbb0000000000000000000000000000000000002';
    const { result: r2 } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(r2.current.hasSeen).toBe(false);
  });

  it('storage event from another tab updates hasSeen', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(result.current.hasSeen).toBe(false);

    act(() => {
      localStorage.setItem(
        'sof:firstview:celebrated:anon:42',
        new Date().toISOString(),
      );
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'sof:firstview:celebrated:anon:42',
          newValue: 'x',
        }),
      );
    });
    expect(result.current.hasSeen).toBe(true);
  });

  it('localStorage throw on set is swallowed (hasSeen stays false)', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException('QuotaExceeded');
    });
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(() => act(() => result.current.markAsSeen())).not.toThrow();
    expect(result.current.hasSeen).toBe(false);
    Storage.prototype.setItem = orig;
  });
});

describe('useFirstViewGateBatch', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAddress = null;
  });

  it('returns Set of seen item keys (anon)', () => {
    localStorage.setItem(
      'sof:firstview:celebrated:anon:1',
      new Date().toISOString(),
    );
    localStorage.setItem(
      'sof:firstview:celebrated:anon:3',
      new Date().toISOString(),
    );
    const { result } = renderHook(() =>
      useFirstViewGateBatch('celebrated', [1, 2, 3]),
    );
    expect(result.current.has('1')).toBe(true);
    expect(result.current.has('2')).toBe(false);
    expect(result.current.has('3')).toBe(true);
  });

  it('normalises BigInt itemKeys to strings', () => {
    localStorage.setItem(
      'sof:firstview:celebrated:anon:5',
      new Date().toISOString(),
    );
    const { result } = renderHook(() =>
      useFirstViewGateBatch('celebrated', [5n, 6n]),
    );
    expect(result.current.has('5')).toBe(true);
    expect(result.current.has('6')).toBe(false);
  });

  it('returns referentially-stable Set when nothing changed across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useFirstViewGateBatch('celebrated', ids),
      { initialProps: { ids: [1, 2] } },
    );
    const first = result.current;
    rerender({ ids: [1, 2] });
    expect(result.current).toBe(first);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd packages/frontend && npm test -- src/hooks/__tests__/useFirstViewGate.test.jsx
```
Expected: all tests FAIL with `Failed to resolve import '../useFirstViewGate'`.

---

## Task 3: `useFirstViewGate` hook — implementation

**Files:**
- Create: `packages/frontend/src/hooks/useFirstViewGate.js`

- [ ] **Step 1: Write the hook**

Create `packages/frontend/src/hooks/useFirstViewGate.js`:

```js
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';

const KEY_PREFIX = 'sof:firstview';

function buildKey(scope, viewer, itemKey) {
  return `${KEY_PREFIX}:${scope}:${viewer}:${String(itemKey)}`;
}

function getViewer(address) {
  if (!address) return 'anon';
  return address.toLowerCase();
}

function safeGet(key) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* swallow quota / private-mode errors */
  }
}

function subscribeToKey(targetKey, callback) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => {
    if (event.key === null || event.key === targetKey) callback();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

export function useFirstViewGate(scope, itemKey) {
  const { address } = useAccount();
  const viewer = getViewer(address);
  const storageKey = buildKey(scope, viewer, itemKey);

  const subscribe = useCallback(
    (callback) => subscribeToKey(storageKey, callback),
    [storageKey],
  );
  const getSnapshot = useCallback(() => !!safeGet(storageKey), [storageKey]);
  const getServerSnapshot = useCallback(() => false, []);

  const hasSeen = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const markAsSeen = useCallback(() => {
    safeSet(storageKey, new Date().toISOString());
    if (typeof window !== 'undefined') {
      // Same-tab notification so useSyncExternalStore re-reads.
      window.dispatchEvent(
        new StorageEvent('storage', { key: storageKey, newValue: 'x' }),
      );
    }
  }, [storageKey]);

  return { hasSeen, markAsSeen };
}

export function useFirstViewGateBatch(scope, itemKeys) {
  const { address } = useAccount();
  const viewer = getViewer(address);

  const subscribe = useCallback((callback) => {
    if (typeof window === 'undefined') return () => {};
    const prefix = `${KEY_PREFIX}:${scope}:${viewer}:`;
    const listener = (event) => {
      if (event.key === null || event.key.startsWith(prefix)) callback();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [scope, viewer]);

  // Build a stable snapshot string so useSyncExternalStore can do identity
  // comparison; the actual Set we return is derived from this string.
  const getSnapshot = useCallback(() => {
    const flags = itemKeys.map((id) => {
      const key = buildKey(scope, viewer, id);
      return safeGet(key) ? '1' : '0';
    });
    return `${itemKeys.map(String).join(',')}|${flags.join('')}`;
  }, [scope, viewer, itemKeys]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => '|',
  );

  const cacheRef = useRef({ snapshot: null, set: new Set() });
  return useMemo(() => {
    if (cacheRef.current.snapshot === snapshot) return cacheRef.current.set;
    const seen = new Set();
    itemKeys.forEach((id) => {
      const key = buildKey(scope, viewer, id);
      if (safeGet(key)) seen.add(String(id));
    });
    cacheRef.current = { snapshot, set: seen };
    return seen;
  }, [snapshot, scope, viewer, itemKeys]);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/frontend && npm test -- src/hooks/__tests__/useFirstViewGate.test.jsx
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useFirstViewGate.js packages/frontend/src/hooks/__tests__/useFirstViewGate.test.jsx
git commit -m "feat(frontend): add useFirstViewGate hook for per-viewer first-view tracking"
```

---

## Task 4: confetti wrapper — failing test

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/__tests__/confetti.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/raffle/celebration/__tests__/confetti.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockConfetti = vi.fn();
mockConfetti.reset = vi.fn();
vi.mock('canvas-confetti', () => ({
  default: mockConfetti,
}));

import { fireWinBurst, reset } from '../confetti';

describe('confetti wrapper', () => {
  beforeEach(() => {
    mockConfetti.mockClear();
    mockConfetti.reset.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires two angled bursts by default', () => {
    fireWinBurst();
    expect(mockConfetti).toHaveBeenCalledTimes(2);
    const [call1, call2] = mockConfetti.mock.calls;
    expect(call1[0].angle).toBeLessThan(90);
    expect(call2[0].angle).toBeGreaterThan(90);
  });

  it('scales particle count when scaled=true (mini-app context)', () => {
    fireWinBurst({ scaled: true });
    const [call] = mockConfetti.mock.calls;
    expect(call[0].particleCount).toBeLessThanOrEqual(60);
  });

  it('uses full particle count when scaled=false', () => {
    fireWinBurst({ scaled: false });
    const totalParticles = mockConfetti.mock.calls.reduce(
      (n, c) => n + c[0].particleCount,
      0,
    );
    expect(totalParticles).toBeGreaterThanOrEqual(100);
  });

  it('bails out under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    fireWinBurst();
    expect(mockConfetti).not.toHaveBeenCalled();
  });

  it('reset() proxies to canvas-confetti.reset', () => {
    reset();
    expect(mockConfetti.reset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/confetti.test.js
```
Expected: FAIL with `Failed to resolve import '../confetti'`.

---

## Task 5: confetti wrapper — implementation

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/confetti.js`

- [ ] **Step 1: Write the wrapper**

Create `packages/frontend/src/components/raffle/celebration/confetti.js`:

```js
import confetti from 'canvas-confetti';

function isReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fireWinBurst({ scaled = false } = {}) {
  if (isReducedMotion()) return;
  const total = scaled ? 60 : 120;
  const perSide = Math.round(total / 2);
  confetti({
    particleCount: perSide,
    angle: 60,
    spread: 70,
    startVelocity: 55,
    origin: { x: 0, y: 0.7 },
    colors: ['#ffd45a', '#ff8a3d', '#a78bfa', '#34d399', '#60a5fa'],
  });
  confetti({
    particleCount: perSide,
    angle: 120,
    spread: 70,
    startVelocity: 55,
    origin: { x: 1, y: 0.7 },
    colors: ['#ffd45a', '#ff8a3d', '#a78bfa', '#34d399', '#60a5fa'],
  });
}

export function reset() {
  if (typeof confetti.reset === 'function') confetti.reset();
}
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/confetti.test.js
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/raffle/celebration/confetti.js packages/frontend/src/components/raffle/celebration/__tests__/confetti.test.js
git commit -m "feat(frontend): add canvas-confetti wrapper with reduced-motion bailout"
```

---

## Task 6: `sponsoredPrizeLabel` helper — failing test

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/__tests__/sponsoredPrizeLabel.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/raffle/celebration/__tests__/sponsoredPrizeLabel.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { formatTopSponsoredPrize } from '../sponsoredPrizeLabel';

describe('formatTopSponsoredPrize', () => {
  it('returns null when no sponsored prizes exist', () => {
    expect(
      formatTopSponsoredPrize({ sponsoredERC20: [], sponsoredERC721: [] }),
    ).toBeNull();
  });

  it('prefers tier-0 ERC-20 with symbol and amount', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [
          {
            targetTier: 0n,
            amount: 1000n * 10n ** 18n,
            tokenSymbol: 'USDC',
            tokenDecimals: 18,
          },
        ],
        sponsoredERC721: [],
      }),
    ).toBe('1000 USDC');
  });

  it('ignores ERC-20 prizes targeted at non-grand tiers', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [
          { targetTier: 1n, amount: 500n, tokenSymbol: 'USDC', tokenDecimals: 6 },
        ],
        sponsoredERC721: [],
      }),
    ).toBeNull();
  });

  it('falls back to ERC-721 collection name + tokenId at tier 0', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [],
        sponsoredERC721: [
          { targetTier: 0n, collectionName: 'CryptoPunks', tokenId: 4242n },
        ],
      }),
    ).toBe('CryptoPunks #4242');
  });

  it("uses 'Sponsored prize' fallback when ERC-721 name() is missing", () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [],
        sponsoredERC721: [
          { targetTier: 0n, collectionName: null, tokenId: 7n },
        ],
      }),
    ).toBe('Sponsored prize #7');
  });

  it('prefers ERC-20 over ERC-721 when both exist at tier 0', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [
          {
            targetTier: 0n,
            amount: 250n * 10n ** 6n,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
          },
        ],
        sponsoredERC721: [
          { targetTier: 0n, collectionName: 'Foo', tokenId: 1n },
        ],
      }),
    ).toBe('250 USDC');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/sponsoredPrizeLabel.test.js
```
Expected: FAIL with `Failed to resolve import '../sponsoredPrizeLabel'`.

---

## Task 7: `sponsoredPrizeLabel` helper — implementation

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/sponsoredPrizeLabel.js`

- [ ] **Step 1: Write the helper**

Create `packages/frontend/src/components/raffle/celebration/sponsoredPrizeLabel.js`:

```js
import { formatUnits } from 'viem';

function formatErc20({ amount, tokenSymbol, tokenDecimals }) {
  try {
    const decimals = Number(tokenDecimals ?? 18);
    const human = formatUnits(BigInt(amount), decimals);
    const trimmed = human.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    return `${trimmed} ${tokenSymbol || 'token'}`;
  } catch {
    return null;
  }
}

function formatErc721({ collectionName, tokenId }) {
  const name = collectionName || 'Sponsored prize';
  return `${name} #${tokenId.toString()}`;
}

/**
 * Derive a one-line addon label for the top tier (grand prize) sponsored prize.
 * Returns null when no tier-0 prize exists.
 */
export function formatTopSponsoredPrize(data) {
  if (!data) return null;
  const { sponsoredERC20 = [], sponsoredERC721 = [] } = data;

  const tier0Erc20 = sponsoredERC20.find((p) => Number(p.targetTier) === 0);
  if (tier0Erc20) {
    const label = formatErc20(tier0Erc20);
    if (label) return label;
  }

  const tier0Erc721 = sponsoredERC721.find((p) => Number(p.targetTier) === 0);
  if (tier0Erc721) return formatErc721(tier0Erc721);

  return null;
}
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/sponsoredPrizeLabel.test.js
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/raffle/celebration/sponsoredPrizeLabel.js packages/frontend/src/components/raffle/celebration/__tests__/sponsoredPrizeLabel.test.js
git commit -m "feat(frontend): add sponsoredPrizeLabel helper for top-tier prize formatting"
```

---

## Task 8: i18n keys

**Files:**
- Modify: `packages/frontend/public/locales/en/raffle.json` (append `celebration` block at the end of the JSON object, before the closing brace)

- [ ] **Step 1: Read current file to find the insertion point**

Run:
```bash
tail -5 packages/frontend/public/locales/en/raffle.json
```
Identify the last existing key and the closing `}`.

- [ ] **Step 2: Append celebration keys**

Add these keys before the final `}` (add a trailing comma to the previous last entry):

```json
  "celebration": {
    "winnerLabel": "Winner",
    "youWonHeadline": "You won!",
    "youWonSubheadline": "Claim your prize below or anytime later.",
    "amountSof": "{{amount}} SOF",
    "sponsoredPrizeAddon": "+ {{prizeName}}",
    "continueHint": "tap anywhere to continue",
    "cancelledHeadline": "Season cancelled",
    "cancelledSubheadline": "Your funds will be refunded."
  }
```

- [ ] **Step 3: Validate JSON parses**

Run:
```bash
node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('packages/frontend/public/locales/en/raffle.json','utf8')).celebration))"
```
Expected: `[ 'winnerLabel', 'youWonHeadline', 'youWonSubheadline', 'amountSof', 'sponsoredPrizeAddon', 'continueHint', 'cancelledHeadline', 'cancelledSubheadline' ]`

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/public/locales/en/raffle.json
git commit -m "feat(frontend): add raffle.celebration i18n keys"
```

---

## Task 9: `CelebrationArtwork` — failing test

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/__tests__/CelebrationArtwork.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/raffle/celebration/__tests__/CelebrationArtwork.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CelebrationArtwork from '../CelebrationArtwork';

describe('CelebrationArtwork', () => {
  it('renders rays + ticket + box for celebrate variant', () => {
    const { container } = render(<CelebrationArtwork variant="celebrate" />);
    expect(container.querySelector('[data-element="rays"]')).not.toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
    expect(container.querySelector('[data-element="box"]')).not.toBeNull();
  });

  it('renders rays + ticket + box for win variant', () => {
    const { container } = render(<CelebrationArtwork variant="win" />);
    expect(container.querySelector('[data-element="rays"]')).not.toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
  });

  it('cancelled variant hides rays and shows shrinking ticket', () => {
    const { container } = render(<CelebrationArtwork variant="cancelled" />);
    expect(container.querySelector('[data-element="rays"]')).toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
  });

  it('respects prefers-reduced-motion (no animation classes)', () => {
    const mediaSpy = window.matchMedia;
    window.matchMedia = () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
    const { container } = render(<CelebrationArtwork variant="celebrate" />);
    // When reduced-motion, the rays element should NOT carry the rotation class.
    const rays = container.querySelector('[data-element="rays"]');
    expect(rays).not.toBeNull();
    expect(rays.getAttribute('data-animated')).toBe('false');
    window.matchMedia = mediaSpy;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/CelebrationArtwork.test.jsx
```
Expected: FAIL with `Failed to resolve import '../CelebrationArtwork'`.

---

## Task 10: `CelebrationArtwork` — implementation

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/CelebrationArtwork.jsx`

- [ ] **Step 1: Write the component**

Create `packages/frontend/src/components/raffle/celebration/CelebrationArtwork.jsx`:

```jsx
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';

function useReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Rays({ animated }) {
  return (
    <svg
      data-element="rays"
      data-animated={animated ? 'true' : 'false'}
      viewBox="-50 -50 100 100"
      width="180"
      height="180"
      style={{
        position: 'absolute',
        inset: '50% 50%',
        transform: 'translate(-50%, -50%)',
        animation: animated ? 'sof-rays-spin 8s linear infinite' : 'none',
      }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="rayGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd45a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffd45a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: 12 }).map((_, i) => (
        <path
          key={i}
          d="M0 -45 L3 -10 L0 0 L-3 -10 Z"
          fill="url(#rayGrad)"
          transform={`rotate(${i * 30})`}
        />
      ))}
      <style>{`@keyframes sof-rays-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}`}</style>
    </svg>
  );
}
Rays.propTypes = { animated: PropTypes.bool.isRequired };

function Ticket({ variant }) {
  const isCancelled = variant === 'cancelled';
  return (
    <motion.svg
      data-element="ticket"
      viewBox="-30 -15 60 30"
      width="120"
      height="60"
      initial={isCancelled ? { scale: 1, opacity: 1 } : { y: -60, scale: 0.6, opacity: 0 }}
      animate={isCancelled ? { scale: 0.7, opacity: 0.5 } : { y: 0, scale: 1, opacity: 1 }}
      transition={{ duration: isCancelled ? 0.7 : 0.5, ease: 'easeOut', delay: isCancelled ? 0 : 0.5 }}
      style={{ position: 'relative', zIndex: 2 }}
    >
      <rect x="-26" y="-11" width="52" height="22" rx="3" fill="#fff" stroke="#222" strokeWidth="1" />
      <line x1="-10" y1="-11" x2="-10" y2="11" stroke="#222" strokeDasharray="2 2" strokeWidth="0.5" />
      <text x="2" y="2" textAnchor="middle" fontSize="6" fill="#222" fontWeight="700">
        WINNER
      </text>
    </motion.svg>
  );
}
Ticket.propTypes = { variant: PropTypes.string.isRequired };

function Box() {
  return (
    <motion.svg
      data-element="box"
      viewBox="-30 -20 60 40"
      width="140"
      height="90"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'backOut', delay: 0.2 }}
      style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 1 }}
      aria-hidden="true"
    >
      <rect x="-28" y="-2" width="56" height="20" rx="2" fill="#8b5cf6" stroke="#5b21b6" strokeWidth="1.2" />
      <rect x="-28" y="-2" width="56" height="3" fill="#a78bfa" />
      <motion.path
        d="M-30 -2 L-30 -10 L30 -10 L30 -2 Z"
        fill="#7c3aed"
        stroke="#5b21b6"
        strokeWidth="1.2"
        initial={{ rotate: 0 }}
        animate={{ rotate: -25 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        style={{ transformOrigin: '-30px -2px' }}
      />
    </motion.svg>
  );
}

function CelebrationArtwork({ variant }) {
  const reduced = useReducedMotion();
  const animated = !reduced && variant !== 'cancelled';
  return (
    <div
      data-element="artwork"
      style={{
        position: 'relative',
        width: 200,
        height: 200,
        margin: '0 auto',
      }}
    >
      {variant !== 'cancelled' && <Rays animated={animated} />}
      <Box />
      <Ticket variant={variant} />
    </div>
  );
}

CelebrationArtwork.propTypes = {
  variant: PropTypes.oneOf(['celebrate', 'win', 'cancelled']).isRequired,
};

export default CelebrationArtwork;
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/CelebrationArtwork.test.jsx
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/raffle/celebration/CelebrationArtwork.jsx packages/frontend/src/components/raffle/celebration/__tests__/CelebrationArtwork.test.jsx
git commit -m "feat(frontend): add CelebrationArtwork SVG composition (box, ticket, rays)"
```

---

## Task 11: `WinnerCelebrationModal` — failing test

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/__tests__/WinnerCelebrationModal.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/raffle/celebration/__tests__/WinnerCelebrationModal.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && opts.amount) return `${opts.amount} SOF`;
      if (opts && opts.prizeName) return `+ ${opts.prizeName}`;
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('@/i18n/config', () => ({ default: { t: (k) => k, language: 'en' } }));

const mockFireWinBurst = vi.fn();
const mockReset = vi.fn();
vi.mock('../confetti', () => ({
  fireWinBurst: (...args) => mockFireWinBurst(...args),
  reset: () => mockReset(),
}));

vi.mock('@/components/user/UsernameDisplay', () => ({
  default: ({ address }) => <span data-testid="username">{address}</span>,
}));

vi.mock('@/components/prizes/ClaimPrizeWidget', () => ({
  default: ({ seasonId }) => <div data-testid="claim-widget">{String(seasonId)}</div>,
}));

import WinnerCelebrationModal from '../WinnerCelebrationModal';

describe('WinnerCelebrationModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFireWinBurst.mockClear();
    mockReset.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('celebrate variant renders winner name, amount, and sponsored line', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1250n * 10n ** 18n}
        sponsoredPrizeLabel="Punk #4242"
        seasonId={42n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('username')).toHaveTextContent('0xaaa');
    expect(screen.getByText(/1250 SOF/)).toBeInTheDocument();
    expect(screen.getByText(/Punk #4242/)).toBeInTheDocument();
  });

  it('win variant renders You won! headline and Claim widget', () => {
    render(
      <WinnerCelebrationModal
        variant="win"
        winnerAddress="0xbbb"
        grandPrizeWei={100n * 10n ** 18n}
        seasonId={7n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('celebration.youWonHeadline')).toBeInTheDocument();
    expect(screen.getByTestId('claim-widget')).toHaveTextContent('7');
  });

  it('cancelled variant renders cancelled copy, no claim widget, no confetti', () => {
    render(
      <WinnerCelebrationModal
        variant="cancelled"
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('celebration.cancelledHeadline')).toBeInTheDocument();
    expect(screen.queryByTestId('claim-widget')).toBeNull();
    expect(mockFireWinBurst).not.toHaveBeenCalled();
  });

  it('fires confetti on mount for celebrate/win', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(mockFireWinBurst).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss on mount (gate auto-record)', () => {
    const onDismiss = vi.fn();
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={onDismiss}
      />,
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('tap-anywhere on backdrop hides the modal', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    const backdrop = screen.getByTestId('celebration-backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('auto-dismisses after 6 seconds for celebrate', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('celebration-backdrop')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('auto-dismisses after 4 seconds for cancelled', () => {
    render(
      <WinnerCelebrationModal
        variant="cancelled"
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('calls confetti.reset on unmount', () => {
    const { unmount } = render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    unmount();
    expect(mockReset).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/WinnerCelebrationModal.test.jsx
```
Expected: FAIL with `Failed to resolve import '../WinnerCelebrationModal'`.

---

## Task 12: `WinnerCelebrationModal` — implementation

**Files:**
- Create: `packages/frontend/src/components/raffle/celebration/WinnerCelebrationModal.jsx`

- [ ] **Step 1: Write the modal**

Create `packages/frontend/src/components/raffle/celebration/WinnerCelebrationModal.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { formatUnits } from 'viem';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import UsernameDisplay from '@/components/user/UsernameDisplay';
import ClaimPrizeWidget from '@/components/prizes/ClaimPrizeWidget';
import CelebrationArtwork from './CelebrationArtwork';
import { fireWinBurst, reset as resetConfetti } from './confetti';

const AUTO_DISMISS_MS = {
  celebrate: 6000,
  win: 6000,
  cancelled: 4000,
};

function formatSofAmount(wei) {
  try {
    const human = formatUnits(BigInt(wei || 0n), 18);
    return Number(human).toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch {
    return '0';
  }
}

function WinnerCelebrationModal({
  variant,
  winnerAddress,
  grandPrizeWei,
  sponsoredPrizeLabel,
  seasonId,
  onDismiss,
}) {
  const { t } = useTranslation('raffle');
  const [open, setOpen] = useState(true);
  const dismissedRef = useRef(false);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setOpen(false);
  };

  // Fire onDismiss immediately on mount so the gate is recorded.
  useEffect(() => {
    onDismiss?.();
    // intentionally only once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confetti on mount for celebrate/win.
  useEffect(() => {
    if (variant === 'celebrate' || variant === 'win') {
      fireWinBurst();
    }
    return () => resetConfetti();
  }, [variant]);

  // Auto-dismiss timer.
  useEffect(() => {
    const ms = AUTO_DISMISS_MS[variant] ?? 6000;
    const id = setTimeout(() => dismiss(), ms);
    return () => clearTimeout(id);
  }, [variant]);

  if (!open) return null;

  const isCancelled = variant === 'cancelled';
  const isWin = variant === 'win';
  const sofText = isCancelled ? null : t('celebration.amountSof', {
    amount: formatSofAmount(grandPrizeWei),
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="celebration-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={dismiss}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(2px)',
          }}
          className="bg-background/80"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 240, damping: 22, delay: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-xl p-6 max-w-sm w-[90%] text-center shadow-2xl"
            style={{ position: 'relative' }}
          >
            <CelebrationArtwork variant={variant} />

            <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
              {isCancelled
                ? t('celebration.cancelledHeadline')
                : isWin
                  ? t('celebration.youWonHeadline')
                  : t('celebration.winnerLabel')}
            </div>

            {!isCancelled && (
              <div className="mt-1 text-lg font-semibold text-foreground">
                <UsernameDisplay address={winnerAddress} className="text-lg" />
              </div>
            )}

            {!isCancelled && (
              <div className="mt-2 text-2xl font-bold text-primary">
                {sofText}
              </div>
            )}

            {sponsoredPrizeLabel && !isCancelled && (
              <div className="mt-1 text-sm text-muted-foreground">
                {t('celebration.sponsoredPrizeAddon', { prizeName: sponsoredPrizeLabel })}
              </div>
            )}

            {isWin && (
              <div className="mt-4">
                <div className="text-sm text-muted-foreground mb-2">
                  {t('celebration.youWonSubheadline')}
                </div>
                <ClaimPrizeWidget seasonId={seasonId} />
              </div>
            )}

            {isCancelled && (
              <div className="mt-2 text-sm text-muted-foreground">
                {t('celebration.cancelledSubheadline')}
              </div>
            )}

            <div className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {t('celebration.continueHint')}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

WinnerCelebrationModal.propTypes = {
  variant: PropTypes.oneOf(['celebrate', 'win', 'cancelled']).isRequired,
  winnerAddress: PropTypes.string,
  grandPrizeWei: PropTypes.any,
  sponsoredPrizeLabel: PropTypes.string,
  seasonId: PropTypes.any.isRequired,
  onDismiss: PropTypes.func,
};

export default WinnerCelebrationModal;
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/frontend && npm test -- src/components/raffle/celebration/__tests__/WinnerCelebrationModal.test.jsx
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/raffle/celebration/WinnerCelebrationModal.jsx packages/frontend/src/components/raffle/celebration/__tests__/WinnerCelebrationModal.test.jsx
git commit -m "feat(frontend): add WinnerCelebrationModal with celebrate/win/cancelled variants"
```

---

## Task 13: Wire modal into `RaffleDetails` — update existing test first

**Files:**
- Modify: `packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx`

- [ ] **Step 1: Read the existing test file to understand current setup**

Run:
```bash
head -60 packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx
```

- [ ] **Step 2: Pre-seed the gate at the top of the existing test file**

In the existing `RaffleDetails.completedBranch.test.jsx`, add a `beforeEach` (or extend the existing one) that seeds the celebration gate so the modal does NOT mount during the original assertions:

```jsx
import { beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  // Pre-seed celebration gate so the WinnerCelebrationModal does not mount
  // and obscure the assertions below. The modal's behaviour is covered in
  // its own test file. The key shape matches useFirstViewGate's contract.
  localStorage.setItem(
    'sof:firstview:celebrated:anon:1', // adjust seasonId if test uses a different one
    new Date().toISOString(),
  );
});
afterEach(() => { localStorage.clear(); });
```

(Find the seasonId(s) actually used in the file's mock data and seed the matching keys.)

- [ ] **Step 3: Run the existing test to verify it still passes (before modal code lands)**

Run:
```bash
cd packages/frontend && npm test -- src/routes/__tests__/RaffleDetails.completedBranch.test.jsx
```
Expected: all existing tests PASS (no behavioural change yet).

- [ ] **Step 4: Add new test asserting modal mounts on unseen completed season**

In the same file, append:

```jsx
describe('WinnerCelebrationModal integration', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it('mounts modal on first view of completed season with winner', async () => {
    // Use the existing test harness/mocks to render RaffleDetails for
    // seasonId=1 with status=5 and a winnerAddress. The modal should appear.
    // (Reuse the file's existing renderRaffleDetails helper.)
    renderRaffleDetails({ seasonId: 1, status: 5, winnerAddress: '0xaaa' });
    expect(await screen.findByTestId('celebration-backdrop')).toBeInTheDocument();
  });

  it('does not re-mount modal after gate marked seen', async () => {
    localStorage.setItem(
      'sof:firstview:celebrated:anon:1',
      new Date().toISOString(),
    );
    renderRaffleDetails({ seasonId: 1, status: 5, winnerAddress: '0xaaa' });
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('mounts cancelled variant for status 6', async () => {
    renderRaffleDetails({ seasonId: 1, status: 6 });
    const modal = await screen.findByTestId('celebration-backdrop');
    expect(modal).toBeInTheDocument();
    expect(screen.getByText('celebration.cancelledHeadline')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the new tests to verify they FAIL**

Run:
```bash
cd packages/frontend && npm test -- src/routes/__tests__/RaffleDetails.completedBranch.test.jsx
```
Expected: the three new tests FAIL because `RaffleDetails.jsx` does not yet mount the modal.

---

## Task 14: Wire modal into `RaffleDetails`

**Files:**
- Modify: `packages/frontend/src/routes/RaffleDetails.jsx` (around lines 27, 43, 456-486)

- [ ] **Step 1: Add imports**

In `packages/frontend/src/routes/RaffleDetails.jsx`, add to the import block at the top:

```jsx
import WinnerCelebrationModal from '@/components/raffle/celebration/WinnerCelebrationModal';
import { useFirstViewGate } from '@/hooks/useFirstViewGate';
import { formatTopSponsoredPrize } from '@/components/raffle/celebration/sponsoredPrizeLabel';
import { useSponsoredPrizes } from '@/hooks/useSponsoredPrizes';
```

- [ ] **Step 2: Add gate + derived state in the component body**

Inside the component, after `seasonIdNumber` is computed and after `winnerSummaryQuery` is set up (search for `winnerSummaryQuery` to find the right place — around the existing `consolationStatus` derivation), add:

```jsx
const celebrationGate = useFirstViewGate('celebrated', seasonIdNumber);
const sponsoredPrizesData = useSponsoredPrizes(seasonId, {
  enabled: statusNum === 5 || statusNum === 6,
});
const topSponsoredPrizeLabel = formatTopSponsoredPrize(sponsoredPrizesData);
```

- [ ] **Step 3: Mount modal in the completed/cancelled branch**

Find the `{(isCompletedSeason || isCancelledSeason) ? (` block (around line 456). Immediately inside the opening `<>` fragment (before the first existing `<div className="px-6 mt-3">`), insert:

```jsx
{(() => {
  const winnerAddr = winnerSummaryQuery?.data?.winnerAddress ?? null;
  const winnerReady = isCancelledSeason || (isCompletedSeason && winnerAddr);
  if (celebrationGate.hasSeen || !winnerReady) return null;
  const variant = isCancelledSeason
    ? 'cancelled'
    : winnerAddr?.toLowerCase() === connectedAddress?.toLowerCase()
      ? 'win'
      : 'celebrate';
  return (
    <WinnerCelebrationModal
      variant={variant}
      winnerAddress={winnerAddr}
      grandPrizeWei={winnerSummaryQuery?.data?.grandPrizeWei}
      sponsoredPrizeLabel={topSponsoredPrizeLabel}
      seasonId={BigInt(seasonIdNumber)}
      onDismiss={celebrationGate.markAsSeen}
    />
  );
})()}
```

- [ ] **Step 4: Run the integration tests**

Run:
```bash
cd packages/frontend && npm test -- src/routes/__tests__/RaffleDetails.completedBranch.test.jsx
```
Expected: all tests (existing + new) PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/routes/RaffleDetails.jsx packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx
git commit -m "feat(frontend): mount WinnerCelebrationModal on first view of completed/cancelled raffle"
```

---

## Task 15: `RaffleList` celebration-hold — failing test

**Files:**
- Create: `packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx`

- [ ] **Step 1: Inspect existing RaffleList tests for patterns**

Run:
```bash
ls packages/frontend/src/routes/__tests__ | grep -i raffle
```

If a `RaffleList*.test.jsx` already exists, mimic its render-harness boilerplate (router, react-query, i18n mocks). Otherwise, write the harness inline using the same pattern as `RaffleDetails.completedBranch.test.jsx`.

- [ ] **Step 2: Write the failing test**

Create `packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => (opts?.count !== undefined ? `${opts.count}` : k) }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('@/i18n/config', () => ({ default: { t: (k) => k, language: 'en' } }));

let mockAddress = null;
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: mockAddress, isConnected: !!mockAddress }),
  useChainId: () => 8453,
}));

const mockSeasons = [
  { id: 1n, status: 5, name: 'Season 1' },          // completed, should hold if unseen
  { id: 2n, status: 6, name: 'Season 2' },          // cancelled, should hold if unseen
  { id: 3n, status: 1, name: 'Season 3' },          // active, unaffected
  { id: 4n, status: 2, name: 'Season 4' },          // settling, unaffected
];

vi.mock('@/hooks/useAllSeasonsQuery', () => ({
  useAllSeasonsQuery: () => ({ data: mockSeasons, isLoading: false }),
}));

// Add minimal mocks for any other hooks RaffleList depends on; mirror what
// the existing RaffleList tests / RaffleDetails tests do.

import RaffleList from '../RaffleList';

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RaffleList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RaffleList celebration hold', () => {
  beforeEach(() => { localStorage.clear(); mockAddress = null; });
  afterEach(() => { localStorage.clear(); });

  it('completed season with unseen gate appears in settling tab, not complete', () => {
    renderList();
    fireEvent.click(screen.getByRole('tab', { name: /settling/i }));
    expect(screen.getByText(/Season 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /complete/i }));
    expect(screen.queryByText(/Season 1/)).toBeNull();
  });

  it('after markAsSeen, completed season appears in complete tab', () => {
    localStorage.setItem(
      'sof:firstview:celebrated:anon:1',
      new Date().toISOString(),
    );
    renderList();
    fireEvent.click(screen.getByRole('tab', { name: /complete/i }));
    expect(screen.getByText(/Season 1/)).toBeInTheDocument();
  });

  it('cancelled season with unseen gate also held in settling', () => {
    renderList();
    fireEvent.click(screen.getByRole('tab', { name: /settling/i }));
    expect(screen.getByText(/Season 2/)).toBeInTheDocument();
  });

  it('upcoming/active/settling-status buckets are unaffected', () => {
    renderList();
    fireEvent.click(screen.getByRole('tab', { name: /active/i }));
    expect(screen.getByText(/Season 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /settling/i }));
    expect(screen.getByText(/Season 4/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run:
```bash
cd packages/frontend && npm test -- src/routes/__tests__/RaffleList.celebrationHold.test.jsx
```
Expected: the first three tests FAIL because RaffleList does not yet apply the override. The fourth may pass already.

If the test fails because of unmocked dependencies of `RaffleList`, add the necessary `vi.mock(...)` blocks (mirror what other RaffleList-adjacent tests stub) and re-run until the failure is the expected behavioural one.

---

## Task 16: `RaffleList` — bucket override

**Files:**
- Modify: `packages/frontend/src/routes/RaffleList.jsx` (around lines 245-262 and import block)

- [ ] **Step 1: Add import**

In `packages/frontend/src/routes/RaffleList.jsx`, add to the import block:

```jsx
import { useFirstViewGateBatch } from '@/hooks/useFirstViewGate';
```

- [ ] **Step 2: Compute seenSet and override bucket assignment**

Find the existing `buckets` `useMemo` (search for `const buckets = useMemo`, around line 254). Replace it with:

```jsx
const seasonIds = useMemo(
  () => displayedSeasons.map((s) => s.id),
  [displayedSeasons],
);
const seenSet = useFirstViewGateBatch('celebrated', seasonIds);

const buckets = useMemo(() => {
  const out = { upcoming: [], active: [], settling: [], complete: [] };
  for (const s of displayedSeasons) {
    let g = getSeasonGroup(s.status);
    if (g === 'complete' && !seenSet.has(String(s.id))) g = 'settling';
    if (out[g]) out[g].push(s);
  }
  return out;
}, [displayedSeasons, seenSet]);
```

- [ ] **Step 3: Run tests**

Run:
```bash
cd packages/frontend && npm test -- src/routes/__tests__/RaffleList.celebrationHold.test.jsx
```
Expected: all 4 tests PASS.

- [ ] **Step 4: Run the rest of the RaffleList tests to confirm no regression**

Run:
```bash
cd packages/frontend && npm test -- src/routes/__tests__/
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/routes/RaffleList.jsx packages/frontend/src/routes/__tests__/RaffleList.celebrationHold.test.jsx
git commit -m "feat(frontend): hold unseen completed raffles in Settling tab per viewer"
```

---

## Task 17: Full-package verification

**Files:** none

- [ ] **Step 1: Run full frontend test suite**

Run:
```bash
cd packages/frontend && npm test
```
Expected: all tests PASS (the entire suite — not just the new files).

- [ ] **Step 2: Lint**

Run:
```bash
cd packages/frontend && npm run lint
```
Expected: zero warnings (the package enforces `--max-warnings 0`).

- [ ] **Step 3: Build**

Run:
```bash
cd packages/frontend && npm run build
```
Expected: clean build, no errors.

- [ ] **Step 4: Manual smoke test**

Run dev server: `cd packages/frontend && npm run dev`, then in a browser at `http://localhost:5174`:

1. Navigate to a completed raffle's detail page — modal should appear with confetti and animation. Tap to dismiss.
2. Reload the page — modal should NOT reappear.
3. Open Raffle List — the just-viewed raffle should now be in the Complete tab.
4. If another completed raffle exists that you have NOT yet opened, it should appear in the Settling tab.
5. Open browser devtools → Rendering → emulate `prefers-reduced-motion: reduce`. Open a fresh (unseen) completed raffle — modal should still appear but with no confetti or animation.
6. Connect a wallet whose address matches the winner of a completed season; open that detail page — modal should show "You won!" headline + Claim widget.

If any step fails, do NOT proceed to Task 18 — diagnose and fix.

---

## Task 18: Version bump (LAST — coordinate with admin agent)

**Files:**
- Modify: `packages/frontend/package.json` (version field only — `canvas-confetti` dep was added in Task 1)

- [ ] **Step 1: Fetch latest origin/main to check what version landed there**

Run:
```bash
git fetch origin
git show origin/main:packages/frontend/package.json | grep '"version"'
```

- [ ] **Step 2: Determine target version**

- If origin/main shows `"version": "0.39.11"` → bump to `0.40.0`.
- If origin/main shows `"version": "0.39.12"` (admin patch landed first) → bump to `0.40.0` (still the next minor from the higher patch base).
- If origin/main shows anything else newer (`0.40.x` already exists) → bump to the next minor above whatever is on main.

- [ ] **Step 3: Update `packages/frontend/package.json`**

Modify the `"version"` field to the chosen value, e.g.:

```json
"version": "0.40.0",
```

- [ ] **Step 4: Verify no lockfile drift**

Run:
```bash
cd packages/frontend && npm install
```
Expected: no changes (version bump alone doesn't alter the lockfile structure beyond the top-level project metadata).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/package.json package-lock.json
git commit -m "chore(frontend): bump version to 0.40.0 for raffle winner celebration"
```

- [ ] **Step 6: Push**

```bash
git push
```

- [ ] **Step 7: Mark PR ready for review**

Run:
```bash
gh pr ready 98
```
Expected: PR #98 transitions from Draft to Ready for Review.

If admin's PR has merged in the meantime and there are conflicts on this branch:
```bash
git fetch origin
git rebase origin/main
# resolve any package.json version conflict by keeping our bump (or bumping
# one step higher than whatever's on main), then:
npm install
git add packages/frontend/package.json package-lock.json
git rebase --continue
git push --force-with-lease
```

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Task(s) |
|--------------|---------|
| `useFirstViewGate` hook (singular + batch) | 2, 3 |
| `WinnerCelebrationModal` (3 variants) | 11, 12 |
| `CelebrationArtwork` (SVG composition + framer-motion) | 9, 10 |
| `confetti.js` wrapper with reduced-motion bailout | 4, 5 |
| `sponsoredPrizeLabel.js` helper | 6, 7 |
| i18n `celebration.*` keys | 8 |
| `canvas-confetti` dependency | 1 |
| RaffleDetails modal mount | 13, 14 |
| RaffleList Settling-tab hold | 15, 16 |
| Reduced-motion handling | 5, 9, 10, 17 (manual) |
| Loading-race gate (winnerDataReady) | 14 (in the IIFE branch) |
| BigInt/Number key normalisation | 2 (test), 3 (impl), 16 (call site uses `String(s.id)`) |
| Cross-tab `storage` event sync | 2 (test), 3 (impl) |
| Auto-dismiss timing (6s / 4s) | 11, 12 |
| Idempotent `markAsSeen` | 3 (overwrite-safe), 12 (`dismissedRef`) |
| Version bump (0.39.11 → 0.40.0) | 18 |
| Full test/lint/build verification | 17 |

All spec items covered.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" patterns. All code blocks contain runnable code.

**3. Type consistency:** `useFirstViewGate` / `useFirstViewGateBatch` names consistent across hook, tests, and call sites. `fireWinBurst` + `reset` exports consistent across wrapper, tests, and modal. `formatTopSponsoredPrize` consistent across helper, tests, and RaffleDetails consumer. Modal prop names (`variant`, `winnerAddress`, `grandPrizeWei`, `sponsoredPrizeLabel`, `seasonId`, `onDismiss`) consistent across modal, tests, and RaffleDetails. `data-testid` values (`celebration-backdrop`, `username`, `claim-widget`) consistent across modal and tests.
