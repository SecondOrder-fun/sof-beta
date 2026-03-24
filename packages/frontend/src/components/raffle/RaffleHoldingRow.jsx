// src/components/raffle/RaffleHoldingRow.jsx
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ExplorerLink from "@/components/common/ExplorerLink";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

/**
 * RaffleHoldingRow - Displays a raffle ticket holding as an AccordionItem
 * Must be used inside an <Accordion> wrapper
 */
const RaffleHoldingRow = ({ row, address, showViewLink = true }) => {
  const seasonKey = `season-${row.seasonId}`;

  // Fetch transactions from database API
  const transactionsQuery = useQuery({
    queryKey: ["raffleTransactions", address, row.seasonId],
    enabled: !!address && !!row?.seasonId,
    queryFn: async () => {
      const url = `${
        import.meta.env.VITE_API_BASE_URL
      }/raffle/transactions/${address}/${row.seasonId}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }

      const data = await response.json();
      return data.transactions || [];
    },
    staleTime: 15000,
  });

  const decimals = Number(row.decimals || 0);
  const base = 10n ** BigInt(decimals);
  const tickets = (row.balance ?? 0n) / base;
  const transactions = transactionsQuery.data || [];
  const txCount = transactions.length;

  return (
    <AccordionItem value={seasonKey}>
      <AccordionTrigger className="px-3 py-2 text-left">
        <div className="flex flex-col w-full">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              Season #{row.seasonId}
              {row.name ? ` — ${row.name}` : ""}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-foreground">
                {tickets.toString()} Tickets
              </span>
              {showViewLink && (
                <Link
                  to={`/raffles/${row.seasonId}`}
                  className="text-primary hover:underline text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Link>
              )}
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {txCount} transaction{txCount !== 1 ? "s" : ""}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="mt-2 border-t border-border pt-2 max-h-48 overflow-y-auto overflow-x-hidden pr-1">
          <p className="font-semibold mb-2 text-foreground">Transactions</p>
          {transactionsQuery.isLoading && (
            <p className="text-muted-foreground">Loading...</p>
          )}
          {transactionsQuery.error && (
            <p className="text-red-500">Error loading transactions</p>
          )}
          {!transactionsQuery.isLoading && !transactionsQuery.error && (
            <div className="space-y-1">
              {transactions.length === 0 && (
                <p className="text-muted-foreground">No transactions found.</p>
              )}
              {transactions
                .sort(
                  (a, b) =>
                    new Date(b.created_at || 0) - new Date(a.created_at || 0)
                )
                .map((t) => (
                  <div
                    key={t.tx_hash + String(t.block_number)}
                    className="text-sm flex justify-between items-center gap-2 py-1"
                  >
                    <span
                      className={
                        t.transaction_type === "BUY"
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {t.transaction_type === "BUY" ? "+" : "-"}
                      {t.ticket_amount} tickets
                    </span>
                    <div className="flex items-center gap-2">
                      <ExplorerLink
                        value={t.tx_hash}
                        type="tx"
                        text="View on Explorer"
                        className="text-xs text-muted-foreground underline"
                        copyLabelText="Copy transaction ID"
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

RaffleHoldingRow.propTypes = {
  row: PropTypes.shape({
    token: PropTypes.string,
    decimals: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    balance: PropTypes.any,
    seasonId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    name: PropTypes.string,
  }).isRequired,
  address: PropTypes.string,
  showViewLink: PropTypes.bool,
};

export default RaffleHoldingRow;
