// src/components/infofi/InfoFiSellPanel.jsx
//
// Sell YES or NO outcome shares back to an FPMM market. Takes a share count (people
// think in shares), quotes the collateral locally from the pool's reserves
// (lib/infofiSellMath), and sends buildSellCalls through executeBatch: the one-off
// setApprovalForAll(pool) when needed, then sell. Used by the desktop BuySellWidget
// and the mobile market page.

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseUnits } from "viem";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TransactionModal from "@/components/admin/TransactionModal";
import { buildSellCalls, readInfoFiSellState } from "@/services/onchainInfoFi";
import { minCollateralOut, quoteSellCollateral } from "@/lib/infofiSellMath";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";

const SLIPPAGE_BPS = 200;

const fmt = (raw) => {
  const n = Number(formatUnits(raw ?? 0n, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

const parseShares = (text) => {
  try {
    const v = parseUnits((text || "").trim() || "0", 18);
    return v > 0n ? v : 0n;
  } catch {
    return null;
  }
};

const InfoFiSellPanel = ({ fpmmAddress, collateralSymbol = "", defaultOutcome = "YES" }) => {
  const { t } = useTranslation("market");
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();
  const { executeBatch } = useSmartTransactions();

  const [outcome, setOutcome] = useState(defaultOutcome);
  const [sharesText, setSharesText] = useState("");

  const stateQuery = useQuery({
    queryKey: ["infofiSellState", fpmmAddress, address],
    enabled: Boolean(address && fpmmAddress),
    queryFn: () => readInfoFiSellState({ fpmmAddress, account: address }),
    staleTime: 5_000,
  });
  const state = stateQuery.data;

  const held = outcome === "YES" ? state?.yesShares ?? 0n : state?.noShares ?? 0n;
  const shares = parseShares(sharesText);
  const tooMany = shares !== null && shares > held;

  const quote = useMemo(() => {
    if (!state || !shares || tooMany) return 0n;
    return quoteSellCollateral({
      yesReserve: state.yesReserve,
      noReserve: state.noReserve,
      feeBps: state.feeBps,
      sellYes: outcome === "YES",
      sharesIn: shares,
    });
  }, [state, shares, tooMany, outcome]);
  const minOut = minCollateralOut(quote, SLIPPAGE_BPS);

  const sell = useMutation({
    mutationFn: async () => {
      const { calls } = await buildSellCalls({
        prediction: outcome === "YES",
        shares,
        account: address,
        fpmmAddress,
        slippageBps: SLIPPAGE_BPS,
      });
      return executeBatch(calls);
    },
    onSuccess: () => {
      // Positions and trades no longer poll — refresh them on a trade, as a buy does.
      qc.invalidateQueries({ queryKey: ["infofiSellState"] });
      qc.invalidateQueries({ queryKey: ["infofiBet"] });
      qc.invalidateQueries({ queryKey: ["infofiCollateral"] });
      qc.invalidateQueries({ queryKey: ["infofiTrades"] });
      qc.invalidateQueries({ queryKey: ["infofiPositionsOnchainActive"] });
      qc.invalidateQueries({ queryKey: ["userPositionsBatch"] });
      setSharesText("");
    },
  });
  const sellStatus = useTransactionStatus(sell);

  const canSell = isConnected && shares && !tooMany && minOut > 0n && !sell.isPending;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("outcome")}>
        {["YES", "NO"].map((o) => (
          <Button
            key={o}
            type="button"
            variant={outcome === o ? "default" : "outline"}
            aria-pressed={outcome === o}
            onClick={() => {
              setOutcome(o);
              setSharesText("");
            }}
            className="flex flex-col h-auto py-3"
          >
            <span className="font-semibold">{o === "YES" ? t("yes") : t("no")}</span>
            <span className="text-xs opacity-80">
              {t("sharesHeld", { amount: fmt(o === "YES" ? state?.yesShares : state?.noShares) })}
            </span>
          </Button>
        ))}
      </div>

      {state && held === 0n ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("noSharesToSell", { outcome: outcome === "YES" ? t("yes") : t("no") })}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <label htmlFor="infofi-sell-shares" className="text-sm font-medium">
              {t("sharesToSell")}
            </label>
            <Input
              id="infofi-sell-shares"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={sharesText}
              onChange={(e) => setSharesText(e.target.value)}
              aria-invalid={tooMany || shares === null}
              className="text-lg"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("sharesHeld", { amount: fmt(held) })}</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={!held}
                onClick={() => setSharesText(formatUnits(held, 18))}
              >
                {t("max")}
              </Button>
            </div>
            {tooMany && <p className="text-xs text-destructive">{t("moreThanHeld")}</p>}
          </div>

          {quote > 0n && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("youReceiveEst")}</span>
                <span className="font-semibold">
                  {fmt(quote)} {collateralSymbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("minReceived")}</span>
                <span className="font-semibold">
                  {fmt(minOut)} {collateralSymbol}
                </span>
              </div>
            </div>
          )}

          {state && !state.approved && (
            <p className="text-xs text-muted-foreground">{t("sellApprovalNote")}</p>
          )}

          <Button type="button" size="lg" className="w-full" disabled={!canSell} onClick={() => sell.mutate()}>
            {sell.isPending
              ? t("submitting")
              : isConnected
                ? t("sellOutcome", { outcome: outcome === "YES" ? t("yes") : t("no") })
                : t("connectWallet")}
          </Button>
          {sell.error && <p className="text-xs text-destructive">{sell.error.shortMessage || sell.error.message}</p>}
        </>
      )}

      <TransactionModal mutation={sellStatus} title={t("sellingShares")} />
    </div>
  );
};

InfoFiSellPanel.propTypes = {
  fpmmAddress: PropTypes.string,
  collateralSymbol: PropTypes.string,
  defaultOutcome: PropTypes.oneOf(["YES", "NO"]),
};

export default InfoFiSellPanel;
