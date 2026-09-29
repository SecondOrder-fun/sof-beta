// src/components/launchpad/LaunchTrades.jsx
//
// Recent trades for one token, from the backend indexer
// (GET /api/launchpad/tokens/:address/trades). Empty until launchTradeListener
// indexes pool swaps — the empty state says so plainly.

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { formatEther } from "viem";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useWarmRead } from "@/hooks/chain/useWarmRead";
import { shortAddress } from "@/lib/format";
import { formatAge, formatPriceGwei, formatSupply } from "@/lib/launchFormat";

const LaunchTrades = ({ token }) => {
  const { t } = useTranslation("launchpad");
  const { data, isLoading, isError } = useWarmRead({
    path: "/launchpad/tokens/:address/trades",
    params: { address: token },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const trades = data?.trades ?? [];

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
                <TableHead className="text-right">{t("detail.eth")}</TableHead>
                <TableHead className="text-right">{t("table.token")}</TableHead>
                <TableHead className="text-right">{t("detail.fdvAtTrade")}</TableHead>
                <TableHead className="text-right">{t("detail.wallet")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((tr) => (
                <TableRow key={`${tr.txHash}:${tr.logIndex}`}>
                  <TableCell className="text-muted-foreground">
                    {tr.blockTime ? formatAge(Math.floor(new Date(tr.blockTime).getTime() / 1000)) : "—"}
                  </TableCell>
                  <TableCell className={tr.side === "BUY" ? "text-success font-semibold" : "text-destructive font-semibold"}>
                    {tr.side === "BUY" ? t("detail.buy") : t("detail.sell")}
                  </TableCell>
                  <TableCell className="text-right">{formatEther(BigInt(tr.ethAmount))}</TableCell>
                  <TableCell className="text-right">{formatSupply(BigInt(tr.tokenAmount))}</TableCell>
                  <TableCell className="text-right">
                    {tr.priceWei ? `${formatPriceGwei(BigInt(tr.priceWei))} gwei` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{shortAddress(tr.trader)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

LaunchTrades.propTypes = {
  token: PropTypes.string.isRequired,
};

export default LaunchTrades;
