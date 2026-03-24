// src/components/curve/HoldersTab.jsx
import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Trophy } from "lucide-react";
import PlayerLabel from "@/components/common/PlayerLabel";
import { Badge } from "@/components/ui/badge";
import { useRaffleHolders } from "@/hooks/useRaffleHolders";
import { useAccount } from "wagmi";
import { useCurveEvents } from "@/hooks/useCurveEvents";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
} from "@/components/common/DataTable";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * HoldersTab - Display token holders with ranking, sorting, and pagination
 * @param {string} bondingCurveAddress - Bonding curve contract address
 * @param {number|string} seasonId - Season ID
 */
const HoldersTab = ({ bondingCurveAddress, seasonId }) => {
  const { t } = useTranslation("raffle");
  const queryClient = useQueryClient();
  const { address: connectedAddress } = useAccount();
  const { holders, totalHolders, totalTickets, isPending, error } =
    useRaffleHolders(bondingCurveAddress, seasonId);

  // Real-time updates: invalidate query when new PositionUpdate events occur
  useCurveEvents(bondingCurveAddress, {
    onPositionUpdate: () => {
      queryClient.invalidateQueries({
        queryKey: ["raffleHolders", bondingCurveAddress, seasonId],
      });
    },
  });

  const [sorting, setSorting] = useState([{ id: "rank", desc: false }]);
  const [columnFilters, setColumnFilters] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });

  // Format relative time
  const formatTime = (timestamp) => {
    if (!timestamp) return "—";
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), {
        addSuffix: true,
      });
    } catch {
      return "—";
    }
  };

  // Get rank badge for top 3
  const getRankBadge = (rank) => {
    if (rank === 1)
      return <Trophy className="h-4 w-4 text-yellow-500" title="1st Place" />;
    if (rank === 2)
      return <Trophy className="h-4 w-4 text-gray-400" title="2nd Place" />;
    if (rank === 3)
      return <Trophy className="h-4 w-4 text-amber-600" title="3rd Place" />;
    return null;
  };

  // Define table columns
  const columns = useMemo(
    () => [
      {
        accessorKey: "rank",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("rank")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const rank = row.getValue("rank");
          return (
            <div className="flex items-center gap-2">
              <span className="font-semibold">{rank}</span>
              {getRankBadge(rank)}
            </div>
          );
        },
        size: 80,
      },
      {
        accessorKey: "player",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("player")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const player = row.getValue("player");
          const original = row.original || {};
          const username = original.playerUsername || original.username;
          const isConnected =
            connectedAddress &&
            player &&
            player.toLowerCase() === connectedAddress.toLowerCase();
          return (
            <div className="flex items-center gap-2">
              <PlayerLabel address={player} name={username} />
              {isConnected && (
                <Badge variant="default" className="text-xs">
                  {t("yourPosition")}
                </Badge>
              )}
            </div>
          );
        },
        size: 180,
      },
      {
        accessorKey: "ticketCount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("tickets")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const tickets = row.getValue("ticketCount");
          return (
            <span className="font-mono font-semibold">
              {Number(tickets).toLocaleString()}
            </span>
          );
        },
        size: 120,
      },
      {
        accessorKey: "winProbabilityBps",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("winProbability")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const probabilityBps = row.getValue("winProbabilityBps");
          const percentage = (probabilityBps / 100).toFixed(2);

          // Color code by probability tier
          let colorClass = "text-gray-600";
          if (probabilityBps >= 1000) colorClass = "text-green-600"; // >= 10%
          else if (probabilityBps >= 500) colorClass = "text-blue-600"; // >= 5%
          else if (probabilityBps >= 100) colorClass = "text-amber-600"; // >= 1%

          return (
            <div className="space-y-1">
              <span className={`font-mono font-semibold ${colorClass}`}>
                {percentage}%
              </span>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full ${colorClass.replace(
                    "text-",
                    "bg-"
                  )}`}
                  style={{ width: `${Math.min(100, probabilityBps / 100)}%` }}
                />
              </div>
            </div>
          );
        },
        size: 140,
      },
      {
        accessorKey: "shareOfTotal",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("shareOfTotal")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const tickets = row.getValue("ticketCount");
          // Use the actual current total tickets, not the stale totalTicketsAtTime
          const share =
            totalTickets > 0n
              ? (Number(tickets) / Number(totalTickets)) * 100
              : 0;
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {share.toFixed(2)}%
            </span>
          );
        },
        size: 100,
      },
      {
        accessorKey: "lastUpdate",
        header: ({ column }) => (
          <DataTableColumnHeader column={column}>
            {t("lastUpdate")}
          </DataTableColumnHeader>
        ),
        cell: ({ row }) => {
          const timestamp = row.getValue("lastUpdate");
          return (
            <span className="text-xs text-muted-foreground">
              {formatTime(timestamp)}
            </span>
          );
        },
        size: 120,
      },
    ],
    [t, connectedAddress, totalTickets]
  );

  if (isPending) {
    return (
      <div className="space-y-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {[t("rank"), t("player"), t("tickets"), t("winProbability"), t("shareOfTotal"), t("lastUpdate")].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                <td className="px-3 py-3"><Skeleton className="h-5 w-10" /></td>
                <td className="px-3 py-3"><Skeleton className="h-5 w-24" /></td>
                <td className="px-3 py-3"><Skeleton className="h-5 w-14" /></td>
                <td className="px-3 py-3">
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                </td>
                <td className="px-3 py-3"><Skeleton className="h-5 w-14" /></td>
                <td className="px-3 py-3"><Skeleton className="h-5 w-20" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-red-600">
        {t("errorLoadingHolders")}: {error.message}
      </div>
    );
  }

  if (holders.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("noHolders")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <div className="text-sm text-muted-foreground">
          {t("totalHolders")}:{" "}
          <span className="font-semibold">{totalHolders}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {t("totalTickets")}:{" "}
          <span className="font-semibold font-mono">
            {Number(totalTickets).toLocaleString()}
          </span>
        </div>
      </div>

      <DataTableToolbar
        table={{
          getState: () => ({ columnFilters }),
          getColumn: (id) => ({
            getFilterValue: () => columnFilters.find((f) => f.id === id)?.value,
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
        }}
        searchColumn="player"
        searchPlaceholder={t("searchAddress")}
      />

      <DataTable
        columns={columns}
        data={holders}
        sorting={sorting}
        setSorting={setSorting}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        pagination={pagination}
        setPagination={setPagination}
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
            (pagination.pageIndex + 1) * pagination.pageSize < holders.length,
          getPageCount: () => Math.ceil(holders.length / pagination.pageSize),
        }}
      />
    </div>
  );
};

HoldersTab.propTypes = {
  bondingCurveAddress: PropTypes.string,
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default HoldersTab;
