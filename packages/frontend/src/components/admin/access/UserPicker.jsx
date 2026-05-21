import { useState, useMemo, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/hooks/useAppAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const MAX_VISIBLE = 20;

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

  const [highlightIndex, setHighlightIndex] = useState(0);
  const blurTimerRef = useRef(null);
  const listboxId = "user-picker-listbox";

  useEffect(() => {
    setHighlightIndex(0);
  }, [inputValue]);

  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

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

  return (
    <div className="relative w-full">
      <Input
        placeholder={placeholder}
        value={inputValue}
        aria-expanded={isOpen && trimmed.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && options[highlightIndex]
            ? `user-picker-opt-${options[highlightIndex].key}`
            : undefined
        }
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
      {isOpen && trimmed && options.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto"
        >
          {options.map((opt, idx) => (
            <li
              key={opt.key}
              id={`user-picker-opt-${opt.key}`}
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
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md"
        >
          <li className="px-3 py-2 text-sm text-muted-foreground">
            No users found
          </li>
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
