import { useState, useMemo } from "react";
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
    </div>
  );
}

UserPicker.propTypes = {
  placeholder: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  autoFocus: PropTypes.bool,
};
