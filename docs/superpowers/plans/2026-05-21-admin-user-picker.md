# Admin User Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual FID/wallet text inputs in `UserAccessPanel` (lookup) and `AccessGroupsPanel` (Add Member) with a shared `UserPicker` typeahead that filters existing `allowlist_entries` and falls back to free-text for new FIDs/0x addresses.

**Architecture:** Single self-contained `<UserPicker>` JSX component. Owns its own input state, dropdown visibility, keyboard nav, and a shared `useQuery(["allowlist-entries-picker"])` against `/allowlist/entries?activeOnly=true&limit=200`. Client-side filtering across username + FID + wallet substring with deterministic ranking. Callers receive a normalized `{ source: "match"|"freeText", fid, wallet, username?, pfpUrl? }` and never re-parse raw text.

**Tech Stack:** React 18, Vitest + @testing-library/react, @tanstack/react-query v5, Tailwind via existing shadcn primitives (`Input`, `Badge` only — no `Popover`/`cmdk`).

**Spec:** `docs/superpowers/specs/2026-05-21-admin-user-picker-design.md`

**Branch:** `feat/admin-user-picker` (already created from `origin/main`; spec already committed).

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `packages/frontend/src/components/admin/access/UserPicker.jsx` | **create** | Input + filtered dropdown; data fetch; keyboard nav; free-text fallback; normalized `onSelect` callback |
| `packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx` | **create** | Component-level tests: render, filter, ranking, free-text, keyboard, fetch-error |
| `packages/frontend/src/components/admin/access/UserAccessPanel.jsx` | **modify** | Replace lookup `<Input>` + Lookup button with `<UserPicker>`; delete `lookupInput`/`handleLookup` |
| `packages/frontend/src/components/admin/access/AccessGroupsPanel.jsx` | **modify** | Replace per-group Add Member `<Input>` + parse helper + Add button with `<UserPicker>`; delete `addMemberInput`/`parseIdentifier` |
| `packages/frontend/src/components/admin/AllowlistPanel.jsx` | **modify** | Add `["allowlist-entries-picker"]` to the existing `invalidateQueries` calls in `addMutation`/`removeMutation`/`importMutation` (3 lines, no UX change) |
| `packages/frontend/package.json` | **modify** | Patch bump `0.39.11 → 0.39.12` |

---

## Task 1: Scaffold `UserPicker` with failing render test

**Files:**
- Create: `packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx`
- Create: `packages/frontend/src/components/admin/access/UserPicker.jsx`

- [ ] **Step 1: Write the failing render test**

`packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ getAuthHeaders: () => ({ Authorization: "Bearer t" }) }),
}));

vi.stubEnv("VITE_API_BASE_URL", "http://test.local/api");

import UserPicker from "../UserPicker";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ entries: [], count: 0 }),
    }),
  );
});

describe("UserPicker", () => {
  it("renders the input with placeholder and dropdown closed by default", () => {
    renderWithClient(
      <UserPicker placeholder="Find a user" onSelect={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText("Find a user")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

Expected: failure with `Cannot find module '../UserPicker'`.

- [ ] **Step 3: Create the minimal component file**

`packages/frontend/src/components/admin/access/UserPicker.jsx`:

```jsx
import { useState } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/hooks/useAppAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function fetchEntries(authHeaders) {
  const res = await fetch(
    `${API_BASE}/allowlist/entries?activeOnly=true&limit=200`,
    { headers: authHeaders },
  );
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

export default function UserPicker({
  placeholder = "@username, FID, or 0x…",
  onSelect,
  disabled = false,
  autoFocus = false,
}) {
  const { getAuthHeaders } = useAppAuth();
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useQuery({
    queryKey: ["allowlist-entries-picker"],
    queryFn: () => fetchEntries(getAuthHeaders()),
    staleTime: 30_000,
  });

  return (
    <div className="relative w-full">
      <Input
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    </div>
  );
}

UserPicker.propTypes = {
  placeholder: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  autoFocus: PropTypes.bool,
};
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/UserPicker.jsx \
        packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx
git commit -m "feat(frontend): scaffold UserPicker shell with stubbed fetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Filter + ranking on input

**Files:**
- Modify: `packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx` — add filter tests
- Modify: `packages/frontend/src/components/admin/access/UserPicker.jsx`

- [ ] **Step 1: Write three failing filter tests**

Append to `UserPicker.test.jsx` inside the `describe` block:

```jsx
import { fireEvent, waitFor } from "@testing-library/react";

const SAMPLE_ENTRIES = [
  { fid: 1001, username: "alice", wallet_address: "0xaaaa000000000000000000000000000000000001", pfpUrl: null },
  { fid: 1002, username: "bob", wallet_address: "0xbbbb000000000000000000000000000000000002", pfpUrl: null },
  { fid: 1003, username: "alicia", wallet_address: "0xcccc000000000000000000000000000000000003", pfpUrl: null },
  { fid: 9999, username: null, wallet_address: "0xdead000000000000000000000000000000000004", pfpUrl: null },
];

function mockFetchWith(entries) {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ entries, count: entries.length }),
    }),
  );
}

it("filters by @username substring", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  renderWithClient(<UserPicker onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "ali" } });
  await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());
  expect(screen.getByText("@alicia")).toBeInTheDocument();
  expect(screen.queryByText("@bob")).not.toBeInTheDocument();
});

it("filters by FID prefix", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  renderWithClient(<UserPicker onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "100" } });
  await waitFor(() => expect(screen.getByText(/FID:1001/)).toBeInTheDocument());
  expect(screen.getByText(/FID:1002/)).toBeInTheDocument();
  expect(screen.queryByText(/FID:9999/)).not.toBeInTheDocument();
});

it("filters by wallet substring (case-insensitive)", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  renderWithClient(<UserPicker onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DEAD" } });
  await waitFor(() => expect(screen.getByText(/0xdead…0004/i)).toBeInTheDocument());
});

it("ranks exact @username above substring matches", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  renderWithClient(<UserPicker onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "alice" } });
  await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());
  const items = screen.getAllByRole("option");
  expect(items[0]).toHaveTextContent("@alice");
  expect(items[1]).toHaveTextContent("@alicia");
});
```

- [ ] **Step 2: Run tests — expect 4 new failures**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

Expected: 1 passing (render test from Task 1), 4 failing.

- [ ] **Step 3: Implement filter, ranking, and dropdown render**

Replace the body of `UserPicker.jsx` with:

```jsx
import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/hooks/useAppAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const MAX_VISIBLE = 20;

async function fetchEntries(authHeaders) {
  const res = await fetch(
    `${API_BASE}/allowlist/entries?activeOnly=true&limit=200`,
    { headers: authHeaders },
  );
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

function truncateWallet(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function rankMatch(entry, q) {
  const username = entry.username?.toLowerCase() ?? "";
  const wallet = entry.wallet_address?.toLowerCase() ?? "";
  const fidStr = entry.fid != null ? String(entry.fid) : "";

  if (username === q) return 0;
  if (fidStr === q) return 1;
  if (wallet.startsWith(q.toLowerCase())) return 2;
  if (
    username.includes(q) ||
    fidStr.startsWith(q) ||
    wallet.includes(q.toLowerCase())
  ) return 3;
  return -1;
}

export default function UserPicker({
  placeholder = "@username, FID, or 0x…",
  onSelect,
  disabled = false,
  autoFocus = false,
}) {
  const { getAuthHeaders } = useAppAuth();
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const entriesQuery = useQuery({
    queryKey: ["allowlist-entries-picker"],
    queryFn: () => fetchEntries(getAuthHeaders()),
    staleTime: 30_000,
  });

  const matches = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return [];
    const all = entriesQuery.data?.entries ?? [];
    const scored = all
      .map((e) => ({ entry: e, rank: rankMatch(e, q) }))
      .filter((x) => x.rank >= 0);
    scored.sort((a, b) => a.rank - b.rank);
    return scored.map((x) => x.entry);
  }, [inputValue, entriesQuery.data]);

  const visible = matches.slice(0, MAX_VISIBLE);
  const overflow = matches.length - visible.length;

  return (
    <div className="relative w-full">
      <Input
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {isOpen && inputValue.trim() && visible.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto"
        >
          {visible.map((entry) => (
            <li
              key={entry.fid ?? entry.wallet_address}
              role="option"
              className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect({
                  source: "match",
                  fid: entry.fid ?? null,
                  wallet: entry.wallet_address ?? null,
                  username: entry.username ?? null,
                  pfpUrl: entry.pfpUrl ?? null,
                });
                setInputValue("");
                setIsOpen(false);
              }}
            >
              {entry.pfpUrl && (
                <img
                  src={entry.pfpUrl}
                  alt=""
                  className="w-4 h-4 rounded-full"
                />
              )}
              <span className="flex-1">
                {entry.username ? `@${entry.username}` : truncateWallet(entry.wallet_address)}
              </span>
              {entry.username && entry.wallet_address && (
                <span className="font-mono text-xs text-muted-foreground">
                  {truncateWallet(entry.wallet_address)}
                </span>
              )}
              {entry.fid && (
                <span className="text-xs text-muted-foreground">
                  FID:{entry.fid}
                </span>
              )}
            </li>
          ))}
          {overflow > 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground border-t">
              +{overflow} more — keep typing
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

UserPicker.propTypes = {
  placeholder: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  autoFocus: PropTypes.bool,
};
```

- [ ] **Step 4: Run tests — expect 5 passing**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/UserPicker.jsx \
        packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx
git commit -m "feat(frontend): UserPicker filter and ranking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Free-text fallback for valid FID / 0x addresses

**Files:**
- Modify: `packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx`
- Modify: `packages/frontend/src/components/admin/access/UserPicker.jsx`

- [ ] **Step 1: Write the failing free-text tests**

Append to the `describe` block:

```jsx
it("offers 'Use 0x…' free-text row when no matches but input is a valid wallet", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  const onSelect = vi.fn();
  renderWithClient(<UserPicker onSelect={onSelect} />);
  const wallet = "0x1111111111111111111111111111111111111111";
  fireEvent.change(screen.getByRole("textbox"), { target: { value: wallet } });
  const row = await screen.findByText(/Use 0x1111…1111/i);
  fireEvent.mouseDown(row.closest("[role='option']"));
  expect(onSelect).toHaveBeenCalledWith({
    source: "freeText",
    fid: null,
    wallet,
  });
});

it("offers 'Use FID N' free-text row when no matches but input is a valid FID", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  const onSelect = vi.fn();
  renderWithClient(<UserPicker onSelect={onSelect} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "55555" } });
  const row = await screen.findByText(/Use FID 55555/);
  fireEvent.mouseDown(row.closest("[role='option']"));
  expect(onSelect).toHaveBeenCalledWith({
    source: "freeText",
    fid: 55555,
    wallet: null,
  });
});

it("shows 'No users found' when no matches and input is neither valid FID nor wallet", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  renderWithClient(<UserPicker onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzz" } });
  expect(await screen.findByText(/No users found/i)).toBeInTheDocument();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests — expect 3 new failures**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

- [ ] **Step 3: Implement the free-text branch**

In `UserPicker.jsx`, add near the top of the file (after `MAX_VISIBLE`):

```jsx
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const FID_RE = /^\d+$/;

function freeTextOption(trimmed) {
  if (WALLET_RE.test(trimmed)) {
    return {
      kind: "wallet",
      label: `Use ${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`,
      payload: { source: "freeText", fid: null, wallet: trimmed },
    };
  }
  if (FID_RE.test(trimmed)) {
    return {
      kind: "fid",
      label: `Use FID ${trimmed}`,
      payload: { source: "freeText", fid: Number(trimmed), wallet: null },
    };
  }
  return null;
}
```

Replace the dropdown JSX in the component body (the `{isOpen && inputValue.trim() && visible.length > 0 && (...)}` block) with:

```jsx
{isOpen && inputValue.trim() && (() => {
  const trimmed = inputValue.trim();
  if (visible.length > 0) {
    return (
      <ul
        role="listbox"
        className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto"
      >
        {visible.map((entry) => (
          <li
            key={entry.fid ?? entry.wallet_address}
            role="option"
            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect({
                source: "match",
                fid: entry.fid ?? null,
                wallet: entry.wallet_address ?? null,
                username: entry.username ?? null,
                pfpUrl: entry.pfpUrl ?? null,
              });
              setInputValue("");
              setIsOpen(false);
            }}
          >
            {entry.pfpUrl && (
              <img
                src={entry.pfpUrl}
                alt=""
                className="w-4 h-4 rounded-full"
              />
            )}
            <span className="flex-1">
              {entry.username ? `@${entry.username}` : truncateWallet(entry.wallet_address)}
            </span>
            {entry.username && entry.wallet_address && (
              <span className="font-mono text-xs text-muted-foreground">
                {truncateWallet(entry.wallet_address)}
              </span>
            )}
            {entry.fid && (
              <span className="text-xs text-muted-foreground">
                FID:{entry.fid}
              </span>
            )}
          </li>
        ))}
        {overflow > 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground border-t">
            +{overflow} more — keep typing
          </li>
        )}
      </ul>
    );
  }
  const ft = freeTextOption(trimmed);
  return (
    <ul
      role="listbox"
      className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md"
    >
      {ft ? (
        <li
          role="option"
          className="px-3 py-2 text-sm cursor-pointer hover:bg-accent"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(ft.payload);
            setInputValue("");
            setIsOpen(false);
          }}
        >
          {ft.label}
        </li>
      ) : (
        <li className="px-3 py-2 text-sm text-muted-foreground">
          No users found
        </li>
      )}
    </ul>
  );
})()}
```

- [ ] **Step 4: Run tests — expect 8 passing**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/UserPicker.jsx \
        packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx
git commit -m "feat(frontend): UserPicker free-text fallback for new FIDs and wallets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Keyboard navigation and blur close

**Files:**
- Modify: `packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx`
- Modify: `packages/frontend/src/components/admin/access/UserPicker.jsx`

- [ ] **Step 1: Write the failing keyboard tests**

Append:

```jsx
it("arrow keys move highlight and Enter selects the highlighted match", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  const onSelect = vi.fn();
  renderWithClient(<UserPicker onSelect={onSelect} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "ali" } });
  await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());

  // First option is highlighted by default (alice). Press ArrowDown -> alicia.
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ source: "match", username: "alicia" }),
  );
});

it("Escape closes the dropdown", async () => {
  mockFetchWith(SAMPLE_ENTRIES);
  renderWithClient(<UserPicker onSelect={vi.fn()} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "ali" } });
  await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests — expect 2 new failures**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

- [ ] **Step 3: Add highlight state, keyboard handlers, and blur-close**

In `UserPicker.jsx`:

a) Add to imports/state — change `useState` to also import `useEffect`, `useRef`:

```jsx
import { useState, useMemo, useEffect, useRef } from "react";
```

b) Inside the component, after the `useQuery` call, add:

```jsx
const [highlightIndex, setHighlightIndex] = useState(0);
const blurTimerRef = useRef(null);

useEffect(() => {
  setHighlightIndex(0);
}, [inputValue]);

useEffect(() => () => clearTimeout(blurTimerRef.current), []);
```

c) Compute a single `options` array right above the JSX return:

```jsx
const trimmed = inputValue.trim();
const ft = visible.length === 0 ? freeTextOption(trimmed) : null;
const options = visible.length > 0
  ? visible.map((entry) => ({
      kind: "match",
      key: entry.fid ?? entry.wallet_address,
      payload: {
        source: "match",
        fid: entry.fid ?? null,
        wallet: entry.wallet_address ?? null,
        username: entry.username ?? null,
        pfpUrl: entry.pfpUrl ?? null,
      },
      entry,
    }))
  : ft
    ? [{ kind: "freetext", key: "ft", payload: ft.payload, label: ft.label }]
    : [];

function commitSelection(idx) {
  const opt = options[idx];
  if (!opt) return;
  onSelect(opt.payload);
  setInputValue("");
  setIsOpen(false);
}
```

d) Add `onKeyDown` to the `Input`:

```jsx
<Input
  placeholder={placeholder}
  value={inputValue}
  onChange={(e) => {
    setInputValue(e.target.value);
    setIsOpen(true);
  }}
  onFocus={() => setIsOpen(true)}
  onBlur={() => {
    blurTimerRef.current = setTimeout(() => setIsOpen(false), 150);
  }}
  onKeyDown={(e) => {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitSelection(highlightIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }}
  disabled={disabled}
  autoFocus={autoFocus}
/>
```

e) Rewrite the dropdown JSX block to use `options` + `highlightIndex` so the highlighted row has class `bg-accent`:

```jsx
{isOpen && trimmed && options.length > 0 && (
  <ul
    role="listbox"
    className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto"
  >
    {options.map((opt, idx) => (
      <li
        key={opt.key}
        role="option"
        aria-selected={idx === highlightIndex}
        className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${
          idx === highlightIndex ? "bg-accent" : "hover:bg-accent"
        }`}
        onMouseEnter={() => setHighlightIndex(idx)}
        onMouseDown={(e) => {
          e.preventDefault();
          commitSelection(idx);
        }}
      >
        {opt.kind === "match" ? (
          <>
            {opt.entry.pfpUrl && (
              <img
                src={opt.entry.pfpUrl}
                alt=""
                className="w-4 h-4 rounded-full"
              />
            )}
            <span className="flex-1">
              {opt.entry.username
                ? `@${opt.entry.username}`
                : truncateWallet(opt.entry.wallet_address)}
            </span>
            {opt.entry.username && opt.entry.wallet_address && (
              <span className="font-mono text-xs text-muted-foreground">
                {truncateWallet(opt.entry.wallet_address)}
              </span>
            )}
            {opt.entry.fid && (
              <span className="text-xs text-muted-foreground">
                FID:{opt.entry.fid}
              </span>
            )}
          </>
        ) : (
          <span>{opt.label}</span>
        )}
      </li>
    ))}
    {visible.length > 0 && overflow > 0 && (
      <li className="px-3 py-2 text-xs text-muted-foreground border-t">
        +{overflow} more — keep typing
      </li>
    )}
  </ul>
)}
{isOpen && trimmed && options.length === 0 && (
  <ul
    role="listbox"
    className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md"
  >
    <li className="px-3 py-2 text-sm text-muted-foreground">
      No users found
    </li>
  </ul>
)}
```

- [ ] **Step 4: Run all tests — expect 10 passing**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

If the "No users found" test from Task 3 now expects `listbox` to be present, that's already covered by the new `options.length === 0` branch. If it fails because `queryAllByRole("option")` finds the empty-state `li`, change that li to not have `role="option"` (already the case above).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/UserPicker.jsx \
        packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx
git commit -m "feat(frontend): UserPicker keyboard navigation and blur close

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fetch-error fallback

**Files:**
- Modify: `packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx`
- Modify: `packages/frontend/src/components/admin/access/UserPicker.jsx`

- [ ] **Step 1: Write the failing fetch-error test**

Append:

```jsx
it("renders a fetch-error fallback message but still allows free-text", async () => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  );
  const onSelect = vi.fn();
  renderWithClient(<UserPicker onSelect={onSelect} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "0x1111111111111111111111111111111111111111" },
  });
  expect(await screen.findByText(/Couldn't load users/i)).toBeInTheDocument();
  // Free-text row still selectable
  const row = await screen.findByText(/Use 0x1111…1111/i);
  fireEvent.mouseDown(row.closest("[role='option']"));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ source: "freeText" }),
  );
});
```

- [ ] **Step 2: Run tests — expect 1 new failure**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

- [ ] **Step 3: Render the fetch-error banner inside the dropdown**

In `UserPicker.jsx`, after destructuring `entriesQuery` add the error banner at the top of the dropdown block. Replace the JSX from `{isOpen && trimmed && options.length > 0 && ...}` through the empty-state listbox with a single combined block:

```jsx
{isOpen && trimmed && (
  <ul
    role="listbox"
    className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto"
  >
    {entriesQuery.isError && (
      <li className="px-3 py-2 text-xs text-destructive border-b">
        Couldn't load users — type a full FID or 0x address
      </li>
    )}
    {options.map((opt, idx) => (
      <li
        key={opt.key}
        role="option"
        aria-selected={idx === highlightIndex}
        className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${
          idx === highlightIndex ? "bg-accent" : "hover:bg-accent"
        }`}
        onMouseEnter={() => setHighlightIndex(idx)}
        onMouseDown={(e) => {
          e.preventDefault();
          commitSelection(idx);
        }}
      >
        {opt.kind === "match" ? (
          <>
            {opt.entry.pfpUrl && (
              <img
                src={opt.entry.pfpUrl}
                alt=""
                className="w-4 h-4 rounded-full"
              />
            )}
            <span className="flex-1">
              {opt.entry.username
                ? `@${opt.entry.username}`
                : truncateWallet(opt.entry.wallet_address)}
            </span>
            {opt.entry.username && opt.entry.wallet_address && (
              <span className="font-mono text-xs text-muted-foreground">
                {truncateWallet(opt.entry.wallet_address)}
              </span>
            )}
            {opt.entry.fid && (
              <span className="text-xs text-muted-foreground">
                FID:{opt.entry.fid}
              </span>
            )}
          </>
        ) : (
          <span>{opt.label}</span>
        )}
      </li>
    ))}
    {visible.length > 0 && overflow > 0 && (
      <li className="px-3 py-2 text-xs text-muted-foreground border-t">
        +{overflow} more — keep typing
      </li>
    )}
    {options.length === 0 && !entriesQuery.isError && (
      <li className="px-3 py-2 text-sm text-muted-foreground">
        No users found
      </li>
    )}
  </ul>
)}
```

- [ ] **Step 4: Run all tests — expect 11 passing**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserPicker.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/UserPicker.jsx \
        packages/frontend/src/components/admin/access/__tests__/UserPicker.test.jsx
git commit -m "feat(frontend): UserPicker fetch-error fallback preserves free-text path

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Push branch and open draft PR

**Files:** none

- [ ] **Step 1: Push the branch and open a draft PR**

The first 5 tasks land a self-contained, tested component. Per `github-pr-workflow` Phase 2, open the PR now so Vercel preview spins up before we wire the panels.

```bash
git push -u origin feat/admin-user-picker
gh pr create --draft --title "feat(frontend): admin user picker (UserAccessPanel + AccessGroupsPanel)" --body "$(cat <<'EOF'
## Summary
- New `UserPicker` component (`packages/frontend/src/components/admin/access/UserPicker.jsx`) — typeahead over `/allowlist/entries` with free-text fallback for new FIDs/0x addresses.
- Spec: `docs/superpowers/specs/2026-05-21-admin-user-picker-design.md`
- Plan: `docs/superpowers/plans/2026-05-21-admin-user-picker.md`
- Wiring into `UserAccessPanel` and `AccessGroupsPanel` lands in the remaining tasks; opening as draft so Vercel preview is ready for testing.

## Test plan
- [ ] `cd packages/frontend && npm test -- UserPicker` — all UserPicker tests pass
- [ ] In preview: open Admin → Access tab → User Access Lookup → type "@…", FID, and 0x prefix; verify ranking and free-text fallback
- [ ] In preview: Admin → Access tab → expand a group → Add Member via picker

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Verify the draft PR exists**

```bash
gh pr view --json url,isDraft,state
```

Expected: `isDraft: true`, `state: OPEN`, a URL.

---

## Task 7: Wire `UserAccessPanel` to use `UserPicker`

**Files:**
- Modify: `packages/frontend/src/components/admin/access/UserAccessPanel.jsx`

- [ ] **Step 1: Read the current file to confirm line ranges**

```bash
sed -n '50,150p' packages/frontend/src/components/admin/access/UserAccessPanel.jsx
```

You're looking for the local state declarations (`lookupInput`, `setLookupInput`), the `handleLookup` function (~94–104), and the JSX block at ~137–148 with `<Input … placeholder="FID (e.g., 12345) …" />` + the Lookup `<Button>`.

- [ ] **Step 2: Edit UserAccessPanel.jsx**

a) **Add the import** near the other access-component imports at the top:

```jsx
import UserPicker from "./UserPicker";
```

b) **Remove obsolete state**. Delete these two lines from the component body:

```jsx
const [lookupInput, setLookupInput] = useState("");
```

(Leave `lookupParams` and `newAccessLevel`.)

c) **Remove the `handleLookup` function** (the block defining the 0x/digits regex parse and calling `setLookupParams`).

d) **Replace the input + button JSX** (the `<div className="flex gap-2">…</div>` containing the Input and Lookup Button) with:

```jsx
<UserPicker
  placeholder="@username, FID, or 0x…"
  onSelect={(r) =>
    setLookupParams(r.fid ? { fid: String(r.fid) } : { wallet: r.wallet })
  }
  disabled={lookupQuery.isFetching}
/>
```

e) **Remove unused imports.** If `Search`, `Input`, `Button` are no longer used in this file, remove them from the import statement. (`Search` is still used inside the `CardTitle`, so keep that one; check before deleting.)

- [ ] **Step 3: Run the existing test suite to catch regressions**

```bash
cd packages/frontend && npx vitest run src/components/admin
```

Expected: any existing tests pass. (If no UserAccessPanel test exists yet, none will run from that file — that's fine.)

- [ ] **Step 4: Manual smoke**

```bash
cd packages/frontend && npm run dev
```

Open the dev URL → Admin → Access tab → User Access Lookup. Confirm:
- Typing `@a` matches usernames
- Typing a known FID matches by FID
- Typing an unknown 0x address shows "Use 0x…" row
- Selecting a row populates the user details card below

Kill the dev server after the smoke.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/UserAccessPanel.jsx
git commit -m "feat(frontend): UserAccessPanel uses UserPicker for lookup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 8: Wire `AccessGroupsPanel` to use `UserPicker`

**Files:**
- Modify: `packages/frontend/src/components/admin/access/AccessGroupsPanel.jsx`

- [ ] **Step 1: Read the file to confirm line ranges**

```bash
sed -n '30,130p' packages/frontend/src/components/admin/access/AccessGroupsPanel.jsx
sed -n '340,400p' packages/frontend/src/components/admin/access/AccessGroupsPanel.jsx
```

You're targeting:
- `addMemberInput` state declaration (~40)
- `parseIdentifier` helper (~112–123)
- The per-group Add Member JSX (~352–387): `<div className="flex gap-2"> <Input …/> <Button …Add…</Button></div>`

- [ ] **Step 2: Edit AccessGroupsPanel.jsx**

a) **Add the import:**

```jsx
import UserPicker from "./UserPicker";
```

b) **Delete obsolete state and helper:**

```jsx
const [addMemberInput, setAddMemberInput] = useState("");
```

Delete the entire `parseIdentifier` arrow function and its surrounding `/** Parse identifier input */` JSDoc block.

c) **Replace the Add Member JSX** (the `<div className="flex gap-2">…</div>` directly under the expanded-group section) with:

```jsx
<UserPicker
  placeholder="@username, FID, or 0x…"
  onSelect={(r) =>
    addMemberMutation.mutate({
      ...(r.fid ? { fid: r.fid } : { wallet: r.wallet }),
      groupSlug: group.slug,
    })
  }
  disabled={addMemberMutation.isPending}
/>
```

Leave the surrounding error/success message JSX as-is (it references `addMemberMutation.error.message` / `addMemberMutation.isSuccess`).

d) **Remove unused imports** if `Input`, `UserPlus`, and the now-unused button are no longer referenced. (Re-check; some are still used elsewhere in this file.)

- [ ] **Step 3: Run the existing test suite**

```bash
cd packages/frontend && npx vitest run src/components/admin
```

Expected: pass.

- [ ] **Step 4: Manual smoke**

```bash
cd packages/frontend && npm run dev
```

Admin → Access tab → Access Groups → expand a group → Add Member. Confirm:
- Picker dropdown appears
- Selecting an existing user fires the mutation (toast/text shows "Member added")
- Free-text adding a never-seen FID also works

Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/AccessGroupsPanel.jsx
git commit -m "feat(frontend): AccessGroupsPanel uses UserPicker for Add Member

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 9: Add picker cache invalidation in `AllowlistPanel`

**Files:**
- Modify: `packages/frontend/src/components/admin/AllowlistPanel.jsx`

- [ ] **Step 1: Locate the existing `invalidateQueries` calls**

```bash
grep -n "invalidateQueries" packages/frontend/src/components/admin/AllowlistPanel.jsx
```

You should see three places (`addMutation.onSuccess`, `removeMutation.onSuccess`, `importMutation.onSuccess`), each calling:

```js
queryClient.invalidateQueries({ queryKey: ["allowlist-stats"] });
queryClient.invalidateQueries({ queryKey: ["allowlist-entries"] });
```

- [ ] **Step 2: Add picker cache invalidation to each**

For each of `addMutation`, `removeMutation`, `retryMutation`, `importMutation`, append one line after the existing invalidations:

```js
queryClient.invalidateQueries({ queryKey: ["allowlist-entries-picker"] });
```

So the `onSuccess` for each mutation becomes (example, addMutation):

```js
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["allowlist-stats"] });
  queryClient.invalidateQueries({ queryKey: ["allowlist-entries"] });
  queryClient.invalidateQueries({ queryKey: ["allowlist-entries-picker"] });
  setAddInput("");
},
```

- [ ] **Step 3: Verify with a grep**

```bash
grep -c '"allowlist-entries-picker"' packages/frontend/src/components/admin/AllowlistPanel.jsx
```

Expected: `4` (one for each of the four mutations).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/admin/AllowlistPanel.jsx
git commit -m "feat(frontend): invalidate UserPicker cache on allowlist mutations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 10: Add the panel-integration tests

**Files:**
- Create: `packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx`
- Create: `packages/frontend/src/components/admin/access/__tests__/AccessGroupsPanel.test.jsx`

- [ ] **Step 1: Write failing UserAccessPanel test**

`packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ getAuthHeaders: () => ({}) }),
}));
vi.stubEnv("VITE_API_BASE_URL", "http://test.local/api");

import UserAccessPanel from "../UserAccessPanel";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/allowlist/entries")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries: [{ fid: 1001, username: "alice", wallet_address: "0xaaaa000000000000000000000000000000000001", pfpUrl: null }],
          count: 1,
        }),
      });
    }
    if (url.includes("/access/check")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          isAllowlisted: true,
          accessLevel: 2,
          levelName: "allowlist",
          groups: [],
          entry: { fid: 1001, username: "alice", wallet_address: "0xaaaa000000000000000000000000000000000001" },
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

describe("UserAccessPanel via UserPicker", () => {
  it("selecting a picker row triggers /access/check and renders the user detail card", async () => {
    renderWithClient(<UserAccessPanel getAuthHeaders={() => ({})} />);
    const input = screen.getByPlaceholderText(/@username, FID, or 0x/);
    fireEvent.change(input, { target: { value: "alice" } });
    const row = await screen.findByText("@alice");
    fireEvent.mouseDown(row.closest("[role='option']"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/access/check?fid=1001"),
        expect.any(Object),
      ),
    );
    expect(await screen.findByText(/Level Name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing AccessGroupsPanel test**

`packages/frontend/src/components/admin/access/__tests__/AccessGroupsPanel.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ getAuthHeaders: () => ({}) }),
}));
vi.stubEnv("VITE_API_BASE_URL", "http://test.local/api");

import AccessGroupsPanel from "../AccessGroupsPanel";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const assignSpy = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
);

beforeEach(() => {
  assignSpy.mockClear();
  global.fetch = vi.fn((url, opts) => {
    if (url.includes("/access/groups/assign")) {
      assignSpy(url, opts);
      return assignSpy.mock.results.slice(-1)[0].value;
    }
    if (url.includes("/access/groups/") && url.endsWith("/members")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ members: [] }),
      });
    }
    if (url.includes("/access/groups")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          groups: [{ slug: "beta", name: "Beta", description: "", member_count: 0 }],
        }),
      });
    }
    if (url.includes("/allowlist/entries")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries: [{ fid: 1001, username: "alice", wallet_address: "0xaaaa000000000000000000000000000000000001", pfpUrl: null }],
          count: 1,
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

describe("AccessGroupsPanel Add Member via UserPicker", () => {
  it("selecting a picker row POSTs to /access/groups/assign with fid and groupSlug", async () => {
    renderWithClient(<AccessGroupsPanel getAuthHeaders={() => ({})} />);
    fireEvent.click(await screen.findByText("Beta"));
    const input = await screen.findByPlaceholderText(/@username, FID, or 0x/);
    fireEvent.change(input, { target: { value: "alice" } });
    const row = await screen.findByText("@alice");
    fireEvent.mouseDown(row.closest("[role='option']"));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    const [, callOpts] = assignSpy.mock.calls[0];
    expect(JSON.parse(callOpts.body)).toEqual({
      fid: 1001,
      groupSlug: "beta",
    });
  });
});
```

- [ ] **Step 3: Run the new tests — expect both PASS (no source changes needed)**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserAccessPanel.test.jsx src/components/admin/access/__tests__/AccessGroupsPanel.test.jsx
```

If a test fails, the wiring from Tasks 7–8 has a bug — fix the wiring (not the test) and re-run.

- [ ] **Step 4: Run the full frontend test suite**

```bash
cd packages/frontend && npm test
```

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx \
        packages/frontend/src/components/admin/access/__tests__/AccessGroupsPanel.test.jsx
git commit -m "test(frontend): UserPicker integration in access panels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 11: Version bump and lint

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 1: Bump the version**

Edit `packages/frontend/package.json` — change `"version": "0.39.11"` to `"version": "0.39.12"`.

- [ ] **Step 2: Run lint and build**

```bash
cd packages/frontend && npm run lint && npm run build
```

Expected: zero warnings, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/package.json
git commit -m "chore(frontend): bump to 0.39.12

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 12: Mark PR ready for review

**Files:** none

- [ ] **Step 1: Mark draft PR ready for review**

```bash
gh pr ready
```

- [ ] **Step 2: Comment with the test plan results**

```bash
gh pr comment --body "Implementation complete. All UserPicker + integration tests passing locally. Manual smoke verified picker dropdown, ranking, free-text fallback, and selection on both UserAccessPanel and AccessGroupsPanel."
```

- [ ] **Step 3: Hand off to user for review**

Tell the user: "PR is ready for review. Run `/ultrareview` against this branch or merge when you're satisfied."

The follow-up SMA-awareness PR will be a separate branch.

---

## Validation Checklist

After all tasks complete, confirm:

- [ ] `cd packages/frontend && npm test` — all green
- [ ] `cd packages/frontend && npm run lint` — zero warnings
- [ ] `cd packages/frontend && npm run build` — succeeds
- [ ] PR is open, not draft, and Vercel preview is accessible
- [ ] Manual smoke in preview: picker works in both UserAccessPanel lookup and AccessGroupsPanel Add Member
- [ ] No regression in AllowlistPanel (its Add input still works the old way per design)
