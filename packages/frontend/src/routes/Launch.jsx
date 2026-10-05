// src/routes/Launch.jsx
//
// The launch form.
//
// The form asks for a **valuation**, not a per-token price, and passes it to the
// contract as-is (`startFdv`). That is the whole design of this page. A start
// price alone says nothing — the number that decides whether a launch behaves
// sanely is `price * supply` — and with a 1e9 supply the two are nine orders of
// magnitude apart. The contract's bounds are set in valuation terms for the same
// reason (TokenLaunchpad.quoteConfig), so asking a creator for a per-token price
// would hand them the one unit in which the floor looks arbitrary.
//
// "Paired with" picks the quote token — ETH, or an ERC-20 the launchpad allows
// (useLaunchpadConfig) — and the valuation is typed in it, against that quote's
// own bounds. An optional first buy, in the same quote, is made inside the
// launch transaction before anyone else can trade (an ERC-20 one is approved in
// the same batch). The per-token price is derived and shown, never typed.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount, useBalance } from "wagmi";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLoginModal } from "@/hooks/useLoginModal";
import { useLaunchRouter } from "@/hooks/useLaunchTrade";
import {
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  utf8Length,
  useLaunchpadConfig,
  useLaunchpadReady,
  useLaunchToken,
  validateLaunchForm,
} from "@/hooks/useTokenLaunchpad";
import { ETH_QUOTE, isNativeQuote } from "@/config/launchQuoteTokens";
import { formatFdv, formatQuoteAmount, formatSupply, formatTokenPrice, parseQuoteAmount } from "@/lib/launchFormat";

const EMPTY_FORM = { name: "", symbol: "", metadataURI: "", fdv: "", firstBuy: "", quote: ETH_QUOTE.address };

const Launch = () => {
  const { t } = useTranslation(["launchpad", "common"]);
  const { address, isConnected } = useAccount();
  const { openLoginModal } = useLoginModal();

  const configQuery = useLaunchpadConfig();
  const readyQuery = useLaunchpadReady();
  const { router, isLoading: isRouterLoading } = useLaunchRouter();
  const { launch, isPending, isSuccess, error, reset } = useLaunchToken();

  const [form, setForm] = useState(EMPTY_FORM);
  const [launchedToken, setLaunchedToken] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const config = configQuery.data;
  const quotes = config?.quotes ?? [];
  // The chosen quote with its bounds; ETH (or the first allowed quote) by default.
  const quote =
    quotes.find((q) => q.address.toLowerCase() === form.quote.toLowerCase()) ?? quotes[0] ?? null;
  const unit = quote ?? ETH_QUOTE;
  const isNative = isNativeQuote(unit.address);

  const fdv = useMemo(() => parseQuoteAmount(form.fdv, unit.decimals), [form.fdv, unit.decimals]);
  const firstBuy = useMemo(() => parseQuoteAmount(form.firstBuy, unit.decimals), [form.firstBuy, unit.decimals]);
  const price = fdv != null && config ? formatTokenPrice(fdv, unit, config.wholeSupply) : null;

  // The creator's balance of the chosen quote, so a first buy they cannot pay
  // for is caught here rather than by a revert.
  const { data: balance } = useBalance({
    address,
    token: isNative ? undefined : unit.address,
    query: { enabled: Boolean(address && firstBuy) },
  });

  const errors = useMemo(
    () =>
      validateLaunchForm(
        { name: form.name, symbol: form.symbol, fdv, firstBuyInput: form.firstBuy, firstBuy },
        { quote: quote ?? undefined, hasRouter: isRouterLoading || Boolean(router), balance: balance?.value ?? null },
      ),
    [form.name, form.symbol, form.firstBuy, fdv, firstBuy, quote, router, isRouterLoading, balance?.value],
  );
  const isValid = Object.keys(errors).length === 0;

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  // Amounts are in the quote's units, so a new quote starts them afresh.
  const setQuote = (next) => setForm((prev) => ({ ...prev, quote: next, fdv: "", firstBuy: "" }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!isValid || fdv == null || !quote) return;
    if (!isConnected) {
      openLoginModal();
      return;
    }
    await launch({
      name: form.name.trim(),
      symbol: form.symbol.trim(),
      metadataURI: form.metadataURI.trim(),
      quoteToken: quote.address,
      startFdv: fdv,
      creatorBuyIn: firstBuy ?? 0n,
    });
    // The token address comes from the receipt's TokenLaunched event, which the
    // indexer will surface. Until then the feed is the destination.
    setLaunchedToken(true);
  };

  // A field's error shows once the form has been submitted, so typing a name
  // does not immediately accuse you of not having finished typing it.
  const errorFor = (field) => (submitted && errors[field] ? errors[field] : null);

  if (!configQuery.isAvailable) {
    return (
      <div className="max-w-2xl mx-auto">
        <Alert>
          <AlertTitle>{t("unavailable.title")}</AlertTitle>
          <AlertDescription>{t("unavailable.body")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isSuccess && launchedToken) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>{t("success.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("success.body")}</p>
            <div className="flex gap-3">
              <Button asChild>
                <Link to="/tokens">{t("success.viewToken")}</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setLaunchedToken(null);
                  setSubmitted(false);
                  setForm(EMPTY_FORM);
                }}
              >
                {t("success.launchAnother")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("launchTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("launchSubtitle")}</p>
      </div>

      {readyQuery.data === false && (
        <Alert className="mb-6">
          <AlertTitle>{t("unavailable.notReadyTitle")}</AlertTitle>
          <AlertDescription>{t("unavailable.notReadyBody")}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="launch-name">{t("form.name")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t("form.characterCount", { count: utf8Length(form.name), max: MAX_NAME_LENGTH })}
                </span>
              </div>
              <Input
                id="launch-name"
                value={form.name}
                onChange={set("name")}
                placeholder={t("form.namePlaceholder")}
                maxLength={MAX_NAME_LENGTH}
              />
              {errorFor("name") && (
                <p className="text-xs text-destructive">
                  {t(errorFor("name"), { max: MAX_NAME_LENGTH })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="launch-symbol">{t("form.symbol")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t("form.characterCount", { count: utf8Length(form.symbol), max: MAX_SYMBOL_LENGTH })}
                </span>
              </div>
              <Input
                id="launch-symbol"
                value={form.symbol}
                onChange={set("symbol")}
                placeholder={t("form.symbolPlaceholder")}
                maxLength={MAX_SYMBOL_LENGTH}
              />
              {errorFor("symbol") && (
                <p className="text-xs text-destructive">
                  {t(errorFor("symbol"), { max: MAX_SYMBOL_LENGTH })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-metadata">{t("form.metadataURI")}</Label>
              <Input
                id="launch-metadata"
                value={form.metadataURI}
                onChange={set("metadataURI")}
                placeholder={t("form.metadataURIPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("form.metadataURIHelp")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-quote">{t("form.pairedWith")}</Label>
              <Select value={unit.address} onValueChange={setQuote} disabled={quotes.length < 2}>
                <SelectTrigger id="launch-quote" aria-label={t("form.pairedWith")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(quotes.length ? quotes : [ETH_QUOTE]).map((q) => (
                    <SelectItem key={q.address} value={q.address}>
                      {q.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("form.pairedWithHelp")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-fdv">{t("form.valuation")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="launch-fdv"
                  value={form.fdv}
                  onChange={set("fdv")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={quote ? formatFdv(quote.minFdv, unit.decimals) : ""}
                />
                <span className="text-sm text-muted-foreground shrink-0">{unit.symbol}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("form.valuationHelp")}
                {quote
                  ? ` ${t("form.valuationRange", {
                      min: formatFdv(quote.minFdv, unit.decimals),
                      max: formatFdv(quote.maxFdv, unit.decimals),
                      quote: unit.symbol,
                    })}`
                  : null}
              </p>
              {errorFor("fdv") && (
                <p className="text-xs text-destructive">
                  {t(errorFor("fdv"), {
                    min: quote ? formatFdv(quote.minFdv, unit.decimals) : "",
                    max: quote ? formatFdv(quote.maxFdv, unit.decimals) : "",
                    quote: unit.symbol,
                  })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-first-buy">{t("form.firstBuy")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="launch-first-buy"
                  value={form.firstBuy}
                  onChange={set("firstBuy")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("form.firstBuyPlaceholder")}
                />
                <span className="text-sm text-muted-foreground shrink-0">{unit.symbol}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t("form.firstBuyHelp")}</p>
              {errorFor("firstBuy") && (
                <p className="text-xs text-destructive">{t(errorFor("firstBuy"), { quote: unit.symbol })}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("summary.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {configQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t("summary.supply")}</dt>
                  <dd className="font-medium text-foreground">
                    {formatSupply(config?.totalSupply)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t("summary.pairedWith")}</dt>
                  <dd className="font-medium text-foreground">{unit.symbol}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t("summary.valuation")}</dt>
                  <dd className="font-medium text-foreground">
                    {fdv != null ? `${formatFdv(fdv, unit.decimals)} ${unit.symbol}` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t("summary.startPrice")}</dt>
                  <dd className="font-medium text-foreground">
                    {price ? `${price.value} ${t("summary.startPriceUnit", { unit: price.unit })}` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t("summary.firstBuy")}</dt>
                  <dd className="font-medium text-foreground">
                    {firstBuy != null
                      ? `${formatQuoteAmount(firstBuy, unit.decimals)} ${unit.symbol}`
                      : t("summary.firstBuyNone")}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-3 border-t">
                  <dt className="text-muted-foreground">{t("summary.allocation")}</dt>
                  <dd className="font-medium text-foreground">{t("summary.allocationValue")}</dd>
                </div>
                <p className="text-xs text-muted-foreground">{t("summary.allocationNote")}</p>
                <div className="flex justify-between gap-4 pt-3 border-t">
                  <dt className="text-muted-foreground">{t("summary.liquidity")}</dt>
                  <dd className="font-medium text-foreground">{t("summary.liquidityValue")}</dd>
                </div>
                <p className="text-xs text-muted-foreground">{t("summary.liquidityNote")}</p>
              </dl>
            )}
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t("errors.launchFailed")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={isPending || readyQuery.data === false}>
          {isPending ? t("form.submitting") : t("form.submit")}
        </Button>
      </form>
    </div>
  );
};

export default Launch;
