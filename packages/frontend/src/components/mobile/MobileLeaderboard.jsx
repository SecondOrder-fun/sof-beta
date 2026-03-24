/**
 * Mobile Leaderboard
 * Mobile-optimized player leaderboard for Farcaster and mobile UIs
 * Uses table format with bottom search panel and adaptive page size
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import BottomNav from "./BottomNav";
import { Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

// Row height (py-2 = 8px*2 + ~20px content = ~36px) + 1px border
const ROW_HEIGHT = 37;
// Table header height
const HEADER_HEIGHT = 29;
// Pagination bar height
const PAGINATION_HEIGHT = 52;
// Search panel rendered height (tabs + input + padding + border + gap)
const SEARCH_PANEL_HEIGHT = 150;

const MobileLeaderboard = () => {
  const { t } = useTranslation(["common", "raffle", "account"]);
  const { address: myAddress } = useAccount();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState("username"); // "username" | "address"
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [cardHeight, setCardHeight] = useState(null);
  const cardRef = useRef(null);
  const searchInputRef = useRef(null);

  // Derive page size from fixed card height
  const rowsForHeight = useCallback(
    (height, isSearchOpen) => {
      if (!height) return 10;
      const searchHeight = isSearchOpen ? SEARCH_PANEL_HEIGHT : 0;
      const tableSpace = height - HEADER_HEIGHT - PAGINATION_HEIGHT - searchHeight;
      return Math.max(3, Math.floor(tableSpace / ROW_HEIGHT));
    },
    []
  );

  // Calculate and lock card height on mount/resize, derive page size from it
  // Depends on `loading` so it re-runs when the card first appears in the DOM
  useEffect(() => {
    const update = () => {
      if (!cardRef.current) return;
      const cardTop = cardRef.current.getBoundingClientRect().top;
      // BottomNav is position:fixed, so measure it directly from the DOM
      const navEl = document.querySelector("nav.fixed.bottom-0");
      const navHeight = navEl ? navEl.getBoundingClientRect().height : 120;
      const h = window.innerHeight - cardTop - navHeight - 12;
      setCardHeight(h);
      setPageSize(rowsForHeight(h, searchOpen));
    };
    const timer = setTimeout(update, 100);
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  }, [rowsForHeight, searchOpen, loading]);

  // Focus search input when opening
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [searchOpen]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/users`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!cancelled) {
          const playersWithRank = (data.players || []).map((player, index) => ({
            rank: index + 1,
            address: typeof player === "string" ? player : player?.address,
            username: typeof player === "string" ? null : player?.username,
          }));
          setPlayers(playersWithRank);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setPlayers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter by search
  const filtered = players.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    if (searchMode === "username") {
      return p.username?.toLowerCase().includes(q);
    }
    return p.address?.toLowerCase().includes(q);
  });

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [search, searchMode]);

  // Clamp page when pageSize changes
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, totalPages - 1)));
  }, [pageSize, totalPages]);

  const handleToggleSearch = () => {
    const willOpen = !searchOpen;
    setSearchOpen(willOpen);
    if (!willOpen) setSearch("");
    // Derive page size from locked card height
    setPageSize(rowsForHeight(cardHeight, willOpen));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden px-3 pt-1 pb-20">
        <h1 className="text-2xl font-bold text-foreground text-left mb-3">
          {t("common:leaderboard")}
        </h1>

        {/* Loading Skeleton */}
        {loading && (
          <Card
            ref={cardRef}
            className="flex flex-col overflow-hidden"
            style={cardHeight ? { height: cardHeight } : undefined}
          >
            <CardContent className="p-0 flex flex-col h-full">
              <div className="flex-1 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5 w-10">
                        #
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">
                        {t("raffle:player")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: pageSize }, (_, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <Skeleton className="h-3.5 w-5" />
                        </td>
                        <td className="px-3 py-2">
                          <Skeleton className="h-3.5 w-32" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Skeleton Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <Skeleton className="h-9 w-9 rounded-md" />
                <Skeleton className="h-4 w-12" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-9 rounded-md" />
                  <Skeleton className="h-9 w-9 rounded-md" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {!loading && error && (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                {t("common:noUsersFound")}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Player Table */}
        {!loading && !error && paged.length > 0 && (
          <Card
            ref={cardRef}
            className="flex flex-col overflow-hidden"
            style={cardHeight ? { height: cardHeight } : undefined}
          >
            <CardContent className="p-0 flex flex-col h-full">
              {/* Table - fills remaining space */}
              <div className="flex-1 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5 w-10">
                        #
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">
                        {t("raffle:player")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((player) => {
                      const isMe =
                        myAddress &&
                        player.address?.toLowerCase() ===
                          myAddress.toLowerCase();
                      const linkTo = isMe
                        ? "/portfolio"
                        : `/users/${player.address}`;

                      return (
                        <tr
                          key={player.address}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-3 py-2">
                            <span className="font-mono text-muted-foreground text-xs">
                              {player.rank}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              to={linkTo}
                              className="text-sm hover:text-primary transition-colors"
                            >
                              <UsernameDisplay
                                address={player.address}
                                showBadge={true}
                              />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Search Panel - animated accordion */}
              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  maxHeight: searchOpen ? `${SEARCH_PANEL_HEIGHT}px` : "0px",
                  opacity: searchOpen ? 1 : 0,
                }}
              >
                <div className="border-t border-border px-4 py-3 space-y-2">
                  <Tabs
                    value={searchMode}
                    onValueChange={(val) => {
                      setSearchMode(val);
                      setSearch("");
                    }}
                  >
                    <TabsList className="w-full">
                      <TabsTrigger value="username" className="flex-1 text-xs">
                        {t("common:username")}
                      </TabsTrigger>
                      <TabsTrigger value="address" className="flex-1 text-xs">
                        {t("account:walletAddress")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      placeholder={
                        searchMode === "username"
                          ? t("common:searchUsername")
                          : t("raffle:searchAddress")
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>

              {/* Pagination + Search Toggle */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={searchOpen ? "default" : "outline"}
                    size="icon"
                    onClick={handleToggleSearch}
                    className="h-9 w-9"
                  >
                    {searchOpen ? (
                      <X className="h-4 w-4" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default MobileLeaderboard;
