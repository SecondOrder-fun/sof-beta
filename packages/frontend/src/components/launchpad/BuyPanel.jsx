// src/components/launchpad/BuyPanel.jsx
//
// Buy or sell a launched token against ETH.
//
// Composed entirely from existing primitives, following the ticket
// BuySellWidget: Tabs for the buy/sell switch, SlippageSettings for tolerance,
// ContentBox for the pay/receive boxes, ButtonGroup for quick amounts.
//
// Quotes are exact and live: lib/v4PoolMath reproduces v4's swap math from the
// pool's own state, pinned against a real PoolManager swap — and the router
// delivers exactly that amount, pinned by UniV4LaunchRouter.t.sol. Trades go
// through whichever router TokenLaunchpad.router() advertises (useLaunchTrade),
// with minimum-out taken from the quote and the slippage setting.

import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccount, useBalance } from "wagmi";
import { formatEther, parseEther } from "viem";
import { Settings } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContentBox } from "@/components/ui/content-box";
import { SlippageSettings } from "@/components/buysell";
import { useQuoteBalance } from "@/hooks/useQuoteBalance";
import { useLaunchTrade } from "@/hooks/useLaunchTrade";
import { useLoginModal } from "@/hooks/useLoginModal";
import { minimumReceived, quoteBuy, quoteSell } from "@/lib/v4PoolMath";
import { formatPriceGwei, formatSupply } from "@/lib/launchFormat";

const BUY_PRESETS = ["0.05", "0.1", "0.5", "1"];
const SELL_PRESETS = [25, 50, 75, 100];

/** "0.1" -> 1e17n; anything unusable -> null (so "not typed yet" differs from zero). */
function parseAmount(input) {
  const s = String(input ?? "").trim();
  if (!s || !/^\d*\.?\d*$/.test(s)) return null;
  try {
    const v = parseEther(s);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** ETH to at most 6 decimals, trailing zeros dropped. */
function formatEth(wei) {
  const [whole, frac = ""] = formatEther(wei).split(".");
  const kept = frac.slice(0, 6).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
}

const BuyPanel = ({ token, symbol, market, className }) => {
  const { t } = useTranslation(["launchpad", "common"]);
  const [side, setSide] = useState("buy");
  const [amount, setAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState("1");
  const [showSettings, setShowSettings] = useState(false);

  const [submitted, setSubmitted] = useState(false);

  // Trades are sent from and settle to the connected wallet.
  const { address, isConnected } = useAccount();
  const { openLoginModal } = useLoginModal();
  const { trade, isPending, error, reset, router } = useLaunchTrade();
  const { data: ethBalance } = useBalance({ address, query: { enabled: Boolean(address) } });
  const { balance: tokenBalance } = useQuoteBalance(token);

  const isBuy = side === "buy";
  const amountWei = parseAmount(amount);

  const quote = useMemo(() => {
    if (!market || amountWei == null) return null;
    return isBuy
      ? quoteBuy({
          sqrtPriceX96: market.sqrtPriceX96,
          liquidity: market.liquidity,
          lpFee: market.buyFee,
          ethIn: amountWei,
          sqrtLowerX96: market.sqrtLowerX96,
          sqrtUpperX96: market.launchSqrtX96,
        })
      : quoteSell({
          sqrtPriceX96: market.sqrtPriceX96,
          liquidity: market.liquidity,
          lpFee: market.sellFee,
          tokensIn: amountWei,
          sqrtUpperX96: market.launchSqrtX96,
          sqrtLowerX96: market.sqrtLowerX96,
        });
  }, [market, amountWei, isBuy]);

  const out = quote ? (isBuy ? quote.tokensOut : quote.ethOut) : null;
  const receive = out == null ? "0" : isBuy ? formatSupply(out) : formatEth(out);
  const minOut = out == null ? null : minimumReceived(out, slippagePct);
  const impactPct = quote ? quote.priceImpact * 100 : null;
  const feePct = market ? (isBuy ? market.buyFee : market.sellFee) / 10_000 : null;

  const onSide = (next) => {
    setSide(next);
    setAmount("");
    setSubmitted(false);
    reset();
  };

  const available = isBuy ? ethBalance?.value : tokenBalance;
  const insufficient = amountWei != null && available != null && amountWei > available;

  // One state drives the button: label, whether it is clickable, and what it does.
  let cta;
  if (!router) cta = { label: isBuy ? t("trade.buyCta", { symbol }) : t("trade.sellCta", { symbol }), disabled: true };
  else if (!isConnected) cta = { label: t("trade.connect"), disabled: false, onClick: openLoginModal };
  else if (amountWei == null) cta = { label: t("trade.enterAmount"), disabled: true };
  else if (insufficient) cta = { label: t("trade.insufficient", { unit: isBuy ? "ETH" : symbol }), disabled: true };
  else if (isPending) cta = { label: t("trade.pending"), disabled: true };
  else if (!out) cta = { label: t("trade.enterAmount"), disabled: true };
  else {
    cta = {
      label: isBuy ? t("trade.buyCta", { symbol }) : t("trade.sellCta", { symbol }),
      disabled: !address,
      onClick: async () => {
        setSubmitted(false);
        try {
          await trade({ side, token, amountIn: amountWei, minOut });
          setAmount("");
          setSubmitted(true);
        } catch {
          // Surfaced from the mutation's `error` below.
        }
      },
    };
  }

  const presets = isBuy
    ? BUY_PRESETS.map((v) => ({ label: v, value: v }))
    : SELL_PRESETS.map((pct) => ({
        label: pct === 100 ? t("common:max", { defaultValue: "Max" }) : `${pct}%`,
        value: tokenBalance ? formatEther((tokenBalance * BigInt(pct)) / 100n) : "",
      }));

  const payUnit = isBuy ? "ETH" : symbol;
  const getUnit = isBuy ? symbol : "ETH";
  const balanceLabel = isBuy
    ? ethBalance ? `${formatEth(ethBalance.value)} ETH` : "—"
    : `${formatSupply(tokenBalance ?? 0n)} ${symbol}`;

  return (
    <Card className={className}>
      <CardContent className="p-5 space-y-4">
        <div className="relative flex items-center gap-2">
          <Tabs value={side} onValueChange={onSide} className="flex-1">
            <TabsList className="w-full">
              <TabsTrigger value="buy" className="flex-1">{t("trade.buy")}</TabsTrigger>
              <TabsTrigger value="sell" className="flex-1">{t("trade.sell")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("trade.slippage")}
            aria-expanded={showSettings}
            onClick={() => setShowSettings((s) => !s)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          {showSettings && (
            <SlippageSettings
              slippagePct={slippagePct}
              onSlippageChange={setSlippagePct}
              onClose={() => setShowSettings(false)}
              variant="desktop"
            />
          )}
        </div>

        <ContentBox className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <Label htmlFor="trade-amount" className="text-xs text-muted-foreground">{t("trade.youPay")}</Label>
            <span>{t("trade.balance", { value: balanceLabel })}</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              id="trade-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-2xl font-semibold h-12"
            />
            <span className="shrink-0 text-sm font-semibold text-heading">{payUnit}</span>
          </div>
        </ContentBox>

        <ButtonGroup className="w-full" aria-label={t("trade.quickAmounts")}>
          {presets.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant={amount === p.value && p.value ? "default" : "outline"}
              size="sm"
              className="flex-1"
              disabled={!p.value}
              onClick={() => setAmount(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </ButtonGroup>

        <ContentBox className="space-y-1">
          <div className="text-xs text-muted-foreground">{t("trade.youReceive")}</div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xl font-semibold text-heading tracking-tight" data-testid="trade-receive">
              {receive}
            </span>
            <span className="text-sm font-semibold text-heading">{getUnit}</span>
          </div>
        </ContentBox>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.price")}</dt>
            <dd>{market ? t("trade.priceValue", { price: formatPriceGwei(market.priceWei), symbol }) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.priceImpact")}</dt>
            <dd className={impactPct != null && impactPct >= 5 ? "text-destructive" : undefined} data-testid="trade-impact">
              {impactPct == null ? "—" : `${impactPct.toFixed(2)}%`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.poolFee")}</dt>
            <dd>{feePct == null ? "—" : `${feePct}%`}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.minReceived")}</dt>
            <dd>
              {minOut == null ? "—" : `${isBuy ? formatSupply(minOut) : formatEth(minOut)} ${getUnit}`}
            </dd>
          </div>
        </dl>

        {quote?.exceedsRange && (
          <p className="text-xs text-fabric-red">{isBuy ? t("trade.exceedsBuy") : t("trade.exceedsSell")}</p>
        )}

        <Button type="button" size="lg" className="w-full" disabled={cta.disabled} onClick={cta.onClick}>
          {cta.label}
        </Button>

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {t("trade.failed")}: {error.shortMessage || error.message}
          </p>
        ) : submitted ? (
          <p className="text-xs text-success" role="status">{t("trade.submitted")}</p>
        ) : null}

        {!router && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">{t("trade.routerOff")}</p>
            <p>{t("trade.routerOffBody")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

BuyPanel.propTypes = {
  token: PropTypes.string.isRequired,
  symbol: PropTypes.string,
  market: PropTypes.object,
  className: PropTypes.string,
};

export default BuyPanel;
