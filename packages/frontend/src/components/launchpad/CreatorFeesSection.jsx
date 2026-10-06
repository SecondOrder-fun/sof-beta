// src/components/launchpad/CreatorFeesSection.jsx
//
// "Creator fees" on the connected user's own profile (desktop ProfileContent,
// mobile Creator tab), per the approved design: every launch the user earns
// from, a total per quote currency (ETH, USDC, …) with one "Claim all <SYMBOL>"
// each, and a Table by launch with each launch's trade fee and its fees not yet
// collected. Trade fees are only ever in a launch's quote, so the per-currency
// claim is the only claim.
//
// Which launches: those the connected wallet created, from the
// backend's creator index (useCreatorLaunches) — so a launch whose fees another
// creator handed TO this account is not listed here (no recipient index yet; its
// token page still shows the card). A listed launch stays while this account is
// its fee recipient; one handed on is dropped (what was already collected for
// this account stays in its per-currency total). Collected fees are pooled per
// account and currency on the placer (one claim takes all of a currency), so
// they show in that currency's total only — the table's "Not yet collected"
// column is each launch's pending share, in its quote. The trade fee is the API
// row's `tradeFee` (pips), so the section needs no pool reads.
//
// Renders nothing with no launches, while loading, or when the backend or chain
// read fails: most accounts never launch, and an "unavailable" box on every
// profile would be noise. Each token page's card reads the chain on its own.
//
// Composed from existing primitives: Card, Table, TokenArt (Avatar), Button,
// plus ClaimedStatus from CreatorFeesCard.

import { useAccount } from "wagmi";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import TokenArt from "@/components/launchpad/TokenArt";
import { ClaimedStatus } from "@/components/launchpad/CreatorFeesCard";
import { useCreatorLaunches } from "@/hooks/useLaunchActivity";
import { useCreatorFees, useCreatorFeeWrite } from "@/hooks/useCreatorFees";
import { formatQuoteAmount, formatTradeFee } from "@/lib/launchFormat";
import { ETH_QUOTE } from "@/config/launchQuoteTokens";
import { currencyKey, planClaimAllQuote, summarizeCreatorFees } from "@/lib/creatorFees";

const CreatorFeesSection = () => {
  const { t } = useTranslation("launchpad");
  const { address } = useAccount();

  const { launches: created } = useCreatorLaunches(address);
  const hasLaunches = created.length > 0;
  const { data } = useCreatorFees(created, { account: address, enabled: hasLaunches });
  const write = useCreatorFeeWrite();

  // What the last claim sent, for the status line; and which currency's button sent it.
  const [claimed, setClaimed] = useState(null);
  const [sending, setSending] = useState(null);
  const titleId = useId();

  if (!hasLaunches || !data) return null;

  const summary = summarizeCreatorFees(data, address);
  if (!summary.rows.length && summary.currencies.every((c) => c.total === 0n)) return null;

  const meta = Object.fromEntries(created.map((l) => [l.token.toLowerCase(), l]));
  const quoteOf = (currency) => data.quotes?.[currencyKey(currency)] ?? ETH_QUOTE;

  const send = async (key, calls, result) => {
    setSending(key);
    setClaimed(null);
    try {
      const hash = await write.send(calls);
      setClaimed({ ...result, hash, to: address });
    } catch {
      // Surfaced from write.error below.
    } finally {
      setSending(null);
    }
  };

  const claimedTitle = (c) =>
    t("creatorFees.claimedQuote", { amount: formatQuoteAmount(c.amount, c.quote.decimals), quote: c.quote.symbol });

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardContent className="p-5 space-y-5">
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {t("creatorFees.profile.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("creatorFees.profile.subtitle")}</p>
        </div>

        {summary.currencies.map(({ currency, collected, pending, total, launchCount }) => {
          const quote = quoteOf(currency);
          const plan = planClaimAllQuote(data, address, currency);
          const key = `quote:${currency}`;
          return (
            <div
              key={currency}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/40 px-4 py-3"
            >
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground">
                  {t("creatorFees.profile.quoteAcross", { count: launchCount, quote: quote.symbol })}
                </div>
                <div className="text-3xl font-semibold tracking-tight text-heading">
                  {formatQuoteAmount(total, quote.decimals)}{" "}
                  <span className="text-base font-medium text-muted-foreground">{quote.symbol}</span>
                </div>
                {collected > 0n && pending > 0n ? (
                  <div className="text-xs text-muted-foreground">
                    {t("creatorFees.profile.quoteBreakdown", {
                      collected: formatQuoteAmount(collected, quote.decimals),
                      pending: formatQuoteAmount(pending, quote.decimals),
                      quote: quote.symbol,
                    })}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                disabled={!plan.calls.length || write.isPending}
                onClick={() => send(key, plan.calls, { amount: plan.amount, quote })}
              >
                {sending === key
                  ? t("creatorFees.claiming")
                  : t("creatorFees.profile.claimAllQuote", { quote: quote.symbol })}
              </Button>
            </div>
          );
        })}

        {claimed ? <ClaimedStatus title={claimedTitle(claimed)} address={claimed.to} hash={claimed.hash} /> : null}
        {write.error ? (
          <p className="text-xs text-destructive" role="alert">
            {t("creatorFees.failed")}: {write.error.shortMessage || write.error.message}
          </p>
        ) : null}

        {summary.rows.length ? (
          <Table>
            <TableCaption className="caption-top mt-0 mb-2 text-left text-xs font-semibold uppercase tracking-wider">
              {t("creatorFees.profile.byLaunch")}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2">{t("creatorFees.profile.colToken")}</TableHead>
                <TableHead className="px-2 text-right">{t("creatorFees.profile.colTradeFee")}</TableHead>
                <TableHead className="px-2 text-right">{t("creatorFees.profile.colQuote")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.map(({ launch, quotePending }) => {
                const info = meta[launch.token.toLowerCase()] ?? {};
                const symbol = info.symbol ?? "";
                const tradeFee = info.tradeFee;
                const quote = quoteOf(launch.quoteToken);
                return (
                  <TableRow key={launch.token}>
                    <TableCell className="px-2">
                      <Link to={`/tokens/${launch.token}`} className="flex items-center gap-3">
                        <TokenArt
                          token={launch.token}
                          symbol={symbol}
                          name={info.name}
                          className="h-8 w-8 rounded-full"
                          textClassName="text-sm"
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold text-heading truncate">{info.name}</span>
                          <span className="block text-xs font-mono text-muted-foreground">${symbol}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="px-2 text-right text-sm">
                      {tradeFee != null ? `${formatTradeFee(tradeFee)}%` : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-right">
                      {quotePending > 0n ? (
                        <span className="font-mono text-sm">
                          {formatQuoteAmount(quotePending, quote.decimals)} {quote.symbol}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        <p className="text-xs text-muted-foreground">{t("creatorFees.profile.footnote")}</p>
      </CardContent>
    </Card>
  );
};

export default CreatorFeesSection;
