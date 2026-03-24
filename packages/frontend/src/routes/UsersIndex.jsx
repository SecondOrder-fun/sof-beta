// src/routes/UsersIndex.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import UsernameDisplay from "@/components/user/UsernameDisplay";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
} from "@/components/common/DataTable";
import { usePlatform } from "@/hooks/usePlatform";
import MobileLeaderboard from "@/components/mobile/MobileLeaderboard";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const UsersIndex = () => {
  const { isMobile } = usePlatform();

  if (isMobile) {
    return <MobileLeaderboard />;
  }

  return <DesktopUsersIndex />;
};

const DesktopUsersIndex = () => {
  const { t } = useTranslation("common");
  const { address: myAddress } = useAccount();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(null);

  // DataTable state
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [globalFilter, setGlobalFilter] = useState("");

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
          // Transform data to include rank
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

  // Define table columns
  const columns = useMemo(
    () => [
      {
        accessorKey: "rank",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>#</DataTableColumnHeader>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">
            {row.getValue("rank")}
          </span>
        ),
        size: 60,
      },
      {
        accessorKey: "address",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("player")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const addr = row.getValue("address");
          if (!addr) return null;

          const isMyAddress =
            myAddress && addr?.toLowerCase?.() === myAddress.toLowerCase();
          const linkTo = isMyAddress ? "/portfolio" : `/users/${addr}`;

          return (
            <Link
              to={linkTo}
              className="hover:text-primary transition-colors"
            >
              <UsernameDisplay address={addr} showBadge={true} />
            </Link>
          );
        },
        size: 300,
        filterFn: (row, columnId, filterValue) => {
          const address = row.getValue(columnId)?.toLowerCase() || "";
          const username = row.original.username?.toLowerCase() || "";
          const filter = filterValue.toLowerCase();
          return address.includes(filter) || username.includes(filter);
        },
      },
    ],
    [t, myAddress]
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-4">{t("leaderboard")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("allUserProfiles")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-muted-foreground">{t("loading")}</p>}
          {error && (
            <div className="space-y-2">
              <p className="text-red-600">Error loading players: {error}</p>
              <p className="text-sm text-muted-foreground">
                Make sure the backend server is running on port 3000.
              </p>
            </div>
          )}
          {!loading && !error && players.length === 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground">{t("noUsersFound")}</p>
              <p className="text-sm text-muted-foreground">
                No players have participated in any seasons yet. Players will
                appear here once they buy tickets in a season.
              </p>
            </div>
          )}
          {!loading && !error && players.length > 0 && (
            <div className="space-y-4">
              <DataTableToolbar
                table={{
                  getState: () => ({ columnFilters, globalFilter }),
                  getColumn: (id) => ({
                    getFilterValue: () =>
                      columnFilters.find((f) => f.id === id)?.value,
                    setFilterValue: (value) => {
                      setColumnFilters((prev) => {
                        const filtered = prev.filter((f) => f.id !== id);
                        return value !== undefined
                          ? [...filtered, { id, value }]
                          : filtered;
                      });
                    },
                  }),
                  resetColumnFilters: () => setColumnFilters([]),
                  setGlobalFilter: setGlobalFilter,
                }}
                searchColumn="address"
                searchPlaceholder={t("searchAddress")}
                globalFilter={globalFilter}
                setGlobalFilter={setGlobalFilter}
              />
              <DataTable
                columns={columns}
                data={players}
                sorting={sorting}
                setSorting={setSorting}
                columnFilters={columnFilters}
                setColumnFilters={setColumnFilters}
                pagination={pagination}
                setPagination={setPagination}
                globalFilter={globalFilter}
                setGlobalFilter={setGlobalFilter}
              />
              <DataTablePagination
                table={{
                  getState: () => ({ pagination }),
                  setPageSize: (size) =>
                    setPagination((prev) => ({ ...prev, pageSize: size })),
                  previousPage: () =>
                    setPagination((prev) => ({
                      ...prev,
                      pageIndex: Math.max(0, prev.pageIndex - 1),
                    })),
                  nextPage: () =>
                    setPagination((prev) => ({
                      ...prev,
                      pageIndex: prev.pageIndex + 1,
                    })),
                  getCanPreviousPage: () => pagination.pageIndex > 0,
                  getCanNextPage: () =>
                    (pagination.pageIndex + 1) * pagination.pageSize <
                    players.length,
                  getPageCount: () =>
                    Math.ceil(players.length / pagination.pageSize),
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UsersIndex;
