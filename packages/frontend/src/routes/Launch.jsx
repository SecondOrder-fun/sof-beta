// src/routes/Launch.jsx
//
// The launch form.
//
// The form asks for a **valuation**, not a per-token price, and converts. That is
// the whole design of this page. A start price alone says nothing — the number
// that decides whether a launch behaves sanely is `price * supply` — and with a
// 1e9 supply the two are nine orders of magnitude apart. The contract's bounds
// are chosen in FDV for the same reason (TokenLaunchpad.sol), so asking a creator
// for wei per token would be handing them the one unit in which the floor looks
// arbitrary.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLoginModal } from "@/hooks/useLoginModal";
import {
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  parseFdvEth,
  fdvWeiToStartPriceWei,
  useLaunchpadConfig,
  useLaunchpadReady,
  useLaunchToken,
  validateLaunchForm,
} from "@/hooks/useTokenLaunchpad";
import { formatFdvEth, formatPriceGwei, formatSupply } from "@/lib/launchFormat";

const Launch = () => {
  const { t } = useTranslation(["launchpad", "common"]);
  const { isConnected } = useAccount();
  const { openLoginModal } = useLoginModal();

  const configQuery = useLaunchpadConfig();
  const readyQuery = useLaunchpadReady();
  const { launch, isPending, isSuccess, error, reset } = useLaunchToken();

  const [form, setForm] = useState({ name: "", symbol: "", metadataURI: "", fdv: "" });
  const [launchedToken, setLaunchedToken] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const config = configQuery.data;
  const fdvWei = useMemo(() => parseFdvEth(form.fdv), [form.fdv]);
  const startPriceWei = useMemo(
    () => (config && fdvWei != null ? fdvWeiToStartPriceWei(fdvWei, config.wholeSupply) : null),
    [config, fdvWei],
  );

  const errors = useMemo(
    () => validateLaunchForm({ name: form.name, symbol: form.symbol, fdvWei }, config),
    [form.name, form.symbol, fdvWei, config],
  );
  const isValid = Object.keys(errors).length === 0;

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!isValid || !startPriceWei) return;
    if (!isConnected) {
      openLoginModal();
      return;
    }
    await launch({
      name: form.name.trim(),
      symbol: form.symbol.trim(),
      metadataURI: form.metadataURI.trim(),
      startPriceWei,
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
                  setForm({ name: "", symbol: "", metadataURI: "", fdv: "" });
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
                  {t("form.characterCount", { count: form.name.length, max: MAX_NAME_LENGTH })}
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
                  {t("form.characterCount", { count: form.symbol.length, max: MAX_SYMBOL_LENGTH })}
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
              <Label htmlFor="launch-fdv">{t("form.valuation")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="launch-fdv"
                  value={form.fdv}
                  onChange={set("fdv")}
                  inputMode="decimal"
                  placeholder={config ? formatFdvEth(config.minFdvWei) : ""}
                />
                <span className="text-sm text-muted-foreground shrink-0">
                  {t("form.valuationUnit")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t("form.valuationHelp")}</p>
              {errorFor("fdv") && (
                <p className="text-xs text-destructive">
                  {t(errorFor("fdv"), {
                    min: config ? formatFdvEth(config.minFdvWei) : "",
                    max: config ? formatFdvEth(config.maxFdvWei) : "",
                  })}
                </p>
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
                  <dt className="text-muted-foreground">{t("summary.valuation")}</dt>
                  <dd className="font-medium text-foreground">
                    {fdvWei != null ? `${formatFdvEth(fdvWei)} ETH` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t("summary.startPrice")}</dt>
                  <dd className="font-medium text-foreground">
                    {startPriceWei != null
                      ? `${formatPriceGwei(startPriceWei)} ${t("summary.startPriceUnit")}`
                      : "—"}
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
