// src/components/launchpad/LaunchTrades.jsx
//
// Recent trades for one token, from the backend indexer
// (GET /api/launchpad/tokens/:address/trades). Empty until launchTradeListener
// indexes pool swaps — the empty state says so plainly. Amounts and prices are
// in the launch's quote token: the `quote` prop (the token page's market or
// launch record), unless a row names its own quoteToken / quoteSymbol /
// quoteDecimals. Trade rows from this route do not carry them — the quote is on
// the token — so without the prop a USDC launch's rows would print as ETH.
// Prices arrive as `priceE18` (quote raw units per whole token × 1e18). A row's
// `quoteAmount` is what the trader paid (a buy, the fee included — for a buy in
// a launch's first seconds, its snipe tax too) or received (a sell, net of it);
// its `feeAmount` is that whole fee, null on older rows.

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useWarmRead } from "@/hooks/chain/useWarmRead";
import { shortAddress } from "@/lib/format";
import { formatAge, formatQuoteAmount, formatSupply, formatTokenPrice } from "@/lib/launchFormat";
import { fdvFromPriceE18 } from "@/lib/launchChart";
import { ETH_QUOTE, quoteFromApi } from "@/config/launchQuoteTokens";

/**
 * A trade's price in the unit people read it in, via the valuation it implies
 * (formatTokenPrice's input), so a 6-decimal quote keeps its precision.
 * @param {string | null | undefined} priceE18  quote raw units per whole token × 1e18
 */
function tradePrice(priceE18, quote) {
  if (!priceE18) return "—";
  const { value, unit } = formatTokenPrice(fdvFromPriceE18(priceE18), quote);
  return `${value} ${unit}`;
}

const LaunchTrades = ({ token, quote: quoteProp }) => {
  const { t } = useTranslation("launchpad");
  const { data, isLoading, isError } = useWarmRead({
    path: "/launchpad/tokens/:address/trades",
    params: { address: token },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const trades = data?.trades ?? [];
  const pageQuote = quoteProp ?? ETH_QUOTE;
  const quoteOf = (tr) => (tr?.quoteToken != null ? quoteFromApi(tr) : pageQuote);
  const columnQuote = trades[0] ? quoteOf(trades[0]) : pageQuote;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("detail.tradesTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : trades.length === 0 || isError ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{t("detail.tradesEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.time")}</TableHead>
                <TableHead>{t("detail.side")}</TableHead>
                <TableHead className="text-right">{columnQuote.symbol}</TableHead>
                <TableHead className="text-right">{t("table.token")}</TableHead>
                <TableHead className="text-right">{t("detail.fdvAtTrade")}</TableHead>
                <TableHead className="text-right">{t("detail.wallet")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((tr) => {
                const quote = quoteOf(tr);
                return (
                <TableRow key={`${tr.txHash}:${tr.logIndex}`}>
                  <TableCell className="text-muted-foreground">
                    {tr.blockTime ? formatAge(Math.floor(new Date(tr.blockTime).getTime() / 1000)) : "—"}
                  </TableCell>
                  <TableCell className={tr.side === "BUY" ? "text-success font-semibold" : "text-destructive font-semibold"}>
                    {tr.side === "BUY" ? t("detail.buy") : t("detail.sell")}
                  </TableCell>
                  <TableCell className="text-right">{formatQuoteAmount(tr.quoteAmount ?? 0, quote.decimals)}</TableCell>
                  <TableCell className="text-right">{formatSupply(BigInt(tr.tokenAmount))}</TableCell>
                  <TableCell className="text-right">{tradePrice(tr.priceE18, quote)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{shortAddress(tr.trader)}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

LaunchTrades.propTypes = {
  token: PropTypes.string.isRequired,
  /** The launch's quote token: the column heading and every row's formatting. */
  quote: PropTypes.shape({ symbol: PropTypes.string, decimals: PropTypes.number }),
};

export default LaunchTrades;
