// src/components/user/SOFTransactionHistory.jsx
import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  TrophyIcon,
  CoinsIcon,
  FilterIcon,
  ExternalLinkIcon,
  GiftIcon,
} from "lucide-react";
import { useSOFTransactions } from "@/hooks/useSOFTransactions";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { formatTimestamp } from "@/lib/utils";

/**
 * Component to display comprehensive $SOF transaction history
 * Shows: transfers, bonding curve trades, prize claims, fees collected
 * @param {string} address - Wallet address
 * @param {boolean} embedded - If true, removes Card wrapper and adds fixed height (for tab usage)
 */
export function SOFTransactionHistory({ address, embedded = false }) {
  const { t } = useTranslation("account");
  const [filter, setFilter] = useState("ALL"); // ALL, IN, OUT, TRADES, PRIZES
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = embedded ? 10 : 20; // Fewer items when embedded

  const {
    data: transactions = [],
    isLoading,
    error,
  } = useSOFTransactions(address);

  const netKey = getStoredNetworkKey();
  const network = getNetworkByKey(netKey);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    if (filter === "ALL") return transactions;
    if (filter === "IN") {
      return transactions.filter((tx) => tx.direction === "IN");
    }
    if (filter === "OUT") {
      return transactions.filter((tx) => tx.direction === "OUT");
    }
    if (filter === "TRADES") {
      return transactions.filter(
        (tx) =>
          tx.type === "BONDING_CURVE_BUY" ||
          tx.type === "BONDING_CURVE_SELL" ||
          tx.type === "RAFFLE_BUY" ||
          tx.type === "RAFFLE_SELL" ||
          tx.type === "INFOFI_BUY" ||
          tx.type === "INFOFI_SELL" ||
          tx.type === "ROLLOVER_BUY"
      );
    }
    if (filter === "PRIZES") {
      return transactions.filter(
        (tx) =>
          tx.type === "PRIZE_CLAIM" ||
          tx.type === "PRIZE_CLAIM_GRAND" ||
          tx.type === "PRIZE_CLAIM_CONSOLATION"
      );
    }
    return transactions;
  }, [transactions, filter]);

  // Paginate
  const paginatedTransactions = useMemo(() => {
    const start = page * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return filteredTransactions.slice(start, end);
  }, [filteredTransactions, page, ITEMS_PER_PAGE]);

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);

  // Calculate summary stats
  const stats = useMemo(() => {
    const totalIn = transactions
      .filter((tx) => tx.direction === "IN")
      .reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

    const totalOut = transactions
      .filter((tx) => tx.direction === "OUT")
      .reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

    const tradeCount = transactions.filter(
      (tx) =>
        tx.type === "BONDING_CURVE_BUY" ||
        tx.type === "BONDING_CURVE_SELL" ||
        tx.type === "RAFFLE_BUY" ||
        tx.type === "RAFFLE_SELL" ||
        tx.type === "INFOFI_BUY" ||
        tx.type === "INFOFI_SELL" ||
        tx.type === "ROLLOVER_BUY"
    ).length;

    const prizeCount = transactions.filter(
      (tx) =>
        tx.type === "PRIZE_CLAIM" ||
        tx.type === "PRIZE_CLAIM_GRAND" ||
        tx.type === "PRIZE_CLAIM_CONSOLATION"
    ).length;

    return {
      totalIn: totalIn.toFixed(2),
      totalOut: totalOut.toFixed(2),
      netFlow: (totalIn - totalOut).toFixed(2),
      tradeCount,
      prizeCount,
      totalTransactions: transactions.length,
    };
  }, [transactions]);

  if (isLoading) {
    if (embedded) {
      return <p className="text-muted-foreground">{t("common:loading")}</p>;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sofTransactionHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t("common:loading")}</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    if (embedded) {
      return <p className="text-red-500">{t("errorLoadingTransactions")}</p>;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sofTransactionHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-500">{t("errorLoadingTransactions")}</p>
        </CardContent>
      </Card>
    );
  }

  // Main content - used both embedded and standalone
  const content = (
    <div className={embedded ? "h-80 overflow-y-auto overflow-x-hidden pr-1" : ""}>
      {/* Summary Stats - more compact when embedded */}
      <div className={`grid ${embedded ? "grid-cols-4" : "grid-cols-2 md:grid-cols-4"} gap-2 mb-4`}>
        <div className="border rounded-lg p-2">
          <div className="text-xs text-muted-foreground">{t("totalReceived")}</div>
          <div className="text-sm font-semibold text-green-600 flex items-center gap-1">
            <ArrowDownIcon className="h-3 w-3" />
            {stats.totalIn} SOF
          </div>
        </div>
        <div className="border rounded-lg p-2">
          <div className="text-xs text-muted-foreground">{t("totalSent")}</div>
          <div className="text-sm font-semibold text-red-600 flex items-center gap-1">
            <ArrowUpIcon className="h-3 w-3" />
            {stats.totalOut} SOF
          </div>
        </div>
        <div className="border rounded-lg p-2">
          <div className="text-xs text-muted-foreground">{t("netFlow")}</div>
          <div className={`text-sm font-semibold ${parseFloat(stats.netFlow) >= 0 ? "text-green-600" : "text-red-600"}`}>
            {stats.netFlow} SOF
          </div>
        </div>
        <div className="border rounded-lg p-2">
          <div className="text-xs text-muted-foreground">{t("totalTransactions")}</div>
          <div className="text-sm font-semibold">{stats.totalTransactions}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1 mb-3">
        <Button variant={filter === "ALL" ? "default" : "outline"} size="sm" onClick={() => { setFilter("ALL"); setPage(0); }}>
          <FilterIcon className="h-3 w-3 mr-1" />{t("all")} ({transactions.length})
        </Button>
        <Button variant={filter === "IN" ? "default" : "outline"} size="sm" onClick={() => { setFilter("IN"); setPage(0); }}>
          <ArrowDownIcon className="h-3 w-3 mr-1" />{t("received")}
        </Button>
        <Button variant={filter === "OUT" ? "default" : "outline"} size="sm" onClick={() => { setFilter("OUT"); setPage(0); }}>
          <ArrowUpIcon className="h-3 w-3 mr-1" />{t("sent")}
        </Button>
        <Button variant={filter === "TRADES" ? "default" : "outline"} size="sm" onClick={() => { setFilter("TRADES"); setPage(0); }}>
          <TrendingUpIcon className="h-3 w-3 mr-1" />{t("trades")} ({stats.tradeCount})
        </Button>
        <Button variant={filter === "PRIZES" ? "default" : "outline"} size="sm" onClick={() => { setFilter("PRIZES"); setPage(0); }}>
          <TrophyIcon className="h-3 w-3 mr-1" />{t("prizes")} ({stats.prizeCount})
        </Button>
      </div>

      {/* Transaction List */}
      {filteredTransactions.length === 0 ? (
        <p className="text-center text-muted-foreground py-4">{t("noTransactionsFound")}</p>
      ) : (
        <>
          <div className="space-y-2">
            {paginatedTransactions.map((tx) => (
              <TransactionRow key={tx.hash + tx.blockNumber} tx={tx} network={network} compact={embedded} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <div className="text-xs text-muted-foreground">
                {page * ITEMS_PER_PAGE + 1}-{Math.min((page + 1) * ITEMS_PER_PAGE, filteredTransactions.length)} of {filteredTransactions.length}
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                  {t("previous")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                  {t("next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // Return embedded or wrapped in Card
  if (embedded) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CoinsIcon className="h-5 w-5" />
          {t("sofTransactionHistory")}
        </CardTitle>
        <CardDescription>
          {t("sofTransactionHistoryDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}

SOFTransactionHistory.propTypes = {
  address: PropTypes.string.isRequired,
  embedded: PropTypes.bool,
};

// Individual transaction row component
function TransactionRow({ tx, network, compact = false }) {
  const { t } = useTranslation("account");

  const getTypeIcon = () => {
    switch (tx.type) {
      case "TRANSFER_IN":
        return <ArrowDownIcon className="h-4 w-4 text-green-600" />;
      case "TRANSFER_OUT":
        return <ArrowUpIcon className="h-4 w-4 text-red-600" />;
      case "RAFFLE_BUY":
      case "BONDING_CURVE_PURCHASE":
      case "BONDING_CURVE_BUY":
        return <TrendingUpIcon className="h-4 w-4 text-blue-600" />;
      case "RAFFLE_SELL":
      case "BONDING_CURVE_SELL":
        return <TrendingDownIcon className="h-4 w-4 text-orange-600" />;
      case "INFOFI_BUY":
        return <TrendingUpIcon className="h-4 w-4 text-purple-600" />;
      case "INFOFI_SELL":
        return <TrendingDownIcon className="h-4 w-4 text-purple-600" />;
      case "ROLLOVER_BUY":
        return <TrendingUpIcon className="h-4 w-4 text-emerald-600" />;
      case "PRIZE_CLAIM":
      case "PRIZE_CLAIM_GRAND":
      case "PRIZE_CLAIM_CONSOLATION":
        return <TrophyIcon className="h-4 w-4 text-yellow-600" />;
      case "AIRDROP":
        return <GiftIcon className="h-4 w-4 text-primary" />;
      case "FEE_COLLECTED":
        return <CoinsIcon className="h-4 w-4 text-purple-600" />;
      default:
        return <CoinsIcon className="h-4 w-4" />;
    }
  };

  const getTypeBadge = () => {
    const typeMap = {
      TRANSFER_IN: { label: t("received"), variant: "default" },
      TRANSFER_OUT: { label: t("sent"), variant: "secondary" },
      RAFFLE_BUY: { label: "Raffle Buy", variant: "default" },
      RAFFLE_SELL: { label: "Raffle Sell", variant: "secondary" },
      BONDING_CURVE_PURCHASE: { label: "Raffle Buy", variant: "default" },
      BONDING_CURVE_BUY: { label: "Raffle Buy", variant: "default" },
      BONDING_CURVE_SELL: { label: "Raffle Sell", variant: "secondary" },
      INFOFI_BUY: { label: "InfoFi Buy", variant: "default" },
      INFOFI_SELL: { label: "InfoFi Sell", variant: "secondary" },
      PRIZE_CLAIM: { label: "Prize Claim", variant: "default" },
      PRIZE_CLAIM_GRAND: { label: t("grandPrize"), variant: "default" },
      PRIZE_CLAIM_CONSOLATION: {
        label: t("consolation"),
        variant: "secondary",
      },
      AIRDROP: { label: t("airdrop"), variant: "default" },
      FEE_COLLECTED: { label: t("fees"), variant: "outline" },
      ROLLOVER_BUY: { label: t("raffle:rolloverBuy", { defaultValue: "Rollover" }), variant: "default" },
    };

    const config = typeMap[tx.type] || { label: tx.type, variant: "outline" };
    const isRollover = tx.type?.startsWith("ROLLOVER");
    return (
      <Badge
        variant={config.variant}
        className={isRollover ? "bg-emerald-600 text-foreground" : undefined}
      >
        {config.label}
      </Badge>
    );
  };

  const formatDate = (timestamp) => {
    return formatTimestamp(timestamp);
  };

  const explorerUrl = network?.blockExplorer
    ? `${network.blockExplorer}/tx/${tx.hash}`
    : null;

  return (
    <div className={`border rounded-lg ${compact ? "p-2" : "p-3"} hover:bg-accent/50 transition-colors`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div className="mt-0.5">{getTypeIcon()}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {getTypeBadge()}
              <span className="text-xs text-muted-foreground">
                {formatDate(tx.timestamp)}
              </span>
            </div>
            {!compact && <p className="text-sm font-medium mb-1">{tx.description}</p>}
            {!compact && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {tx.seasonId && <span>Season #{tx.seasonId}</span>}
                {tx.tokensReceived && (
                  <span>+{parseFloat(tx.tokensReceived).toFixed(2)} tickets</span>
                )}
                {tx.tokensSold && (
                  <span>-{parseFloat(tx.tokensSold).toFixed(2)} tickets</span>
                )}
                {tx.from && tx.type.includes("TRANSFER") && (
                  <span className="font-mono truncate max-w-[120px]">
                    {tx.direction === "IN" ? `From: ${tx.from}` : `To: ${tx.to}`}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={`text-sm font-semibold ${
              tx.direction === "IN" ? "text-green-600" : "text-red-600"
            }`}
          >
            {tx.direction === "IN" ? "+" : "-"}
            {parseFloat(tx.amount).toFixed(4)} SOF
          </div>
          {!compact && explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              {t("viewTx")}
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

TransactionRow.propTypes = {
  tx: PropTypes.shape({
    type: PropTypes.string.isRequired,
    hash: PropTypes.string.isRequired,
    blockNumber: PropTypes.any.isRequired,
    timestamp: PropTypes.number.isRequired,
    amount: PropTypes.string.isRequired,
    direction: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    seasonId: PropTypes.number,
    sourceSeasonId: PropTypes.number,
    bonusAmount: PropTypes.string,
    tokensReceived: PropTypes.string,
    tokensSold: PropTypes.string,
    from: PropTypes.string,
    to: PropTypes.string,
  }).isRequired,
  network: PropTypes.shape({
    blockExplorer: PropTypes.string,
  }),
  compact: PropTypes.bool,
};
