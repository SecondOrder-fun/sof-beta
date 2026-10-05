// src/components/launchpad/BuyPanel.jsx
//
// Buy or sell a launched token against its quote token — native ETH or the
// allowlisted ERC-20 the launch was paired with (market.quote, else the `quote`
// prop from the launch record while the pool is read). Buys are paid in the
// quote and sells pay out in it; an ERC-20 quote's balance is its balanceOf.
//
// Composed entirely from existing primitives, following the ticket
// BuySellWidget: Tabs for the buy/sell switch, SlippageSettings for tolerance,
// ContentBox for the pay/receive boxes, ButtonGroup for quick amounts.
//
// Quotes are exact and live: lib/v4PoolMath reproduces v4's swap math from the
// pool's own state in either orientation, with the launch's own trade fee taken
// in the quote (off a buy's payment, out of a sell's proceeds), pinned against
// real PoolManager swaps — and the router delivers exactly that amount, pinned
// by UniV4LaunchRouter.t.sol. The summary shows that fee in the quote. Trades go through whichever router
// TokenLaunchpad.router() advertises (useLaunchTrade), with minimum-out taken
// from the quote and the slippage setting. An ERC-20 buy batches the router's
// approval with the buy; an ETH buy sends the ETH with it.

import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
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
import { formatSupply, formatTokenPrice, formatTradeFee, parseQuoteAmount } from "@/lib/launchFormat";
import { DEFAULT_BUY_PRESETS, ETH_QUOTE, findLaunchQuote, isNativeQuote } from "@/config/launchQuoteTokens";
import { getStoredNetworkKey } from "@/lib/wagmi";

const SELL_PRESETS = [25, 50, 75, 100];
/** Launch tokens are always 18 decimals. */
const TOKEN_DECIMALS = 18;

/** A raw amount to at most 6 decimals, trailing zeros dropped. */
function formatPrecise(raw, decimals) {
  const [whole, frac = ""] = formatUnits(raw, decimals).split(".");
  const kept = frac.slice(0, 6).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
}

const BuyPanel = ({ token, symbol, market, quote: quoteProp, className }) => {
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

  // What this launch trades against. The listed entry adds the quick amounts.
  const quote = market?.quote ?? quoteProp ?? ETH_QUOTE;
  const isNative = isNativeQuote(quote.address);
  const buyPresets = findLaunchQuote(quote.address, getStoredNetworkKey())?.buyPresets ?? DEFAULT_BUY_PRESETS;
  const { data: ethBalance } = useBalance({ address, query: { enabled: Boolean(address && isNative) } });
  // An ERC-20 quote's balance; for ETH this reads the token again and is unused.
  const { balance: erc20QuoteBalance } = useQuoteBalance(isNative ? token : quote.address);
  const { balance: tokenBalance } = useQuoteBalance(token);
  const quoteBalance = isNative ? ethBalance?.value : erc20QuoteBalance;

  const isBuy = side === "buy";
  const payDecimals = isBuy ? quote.decimals : TOKEN_DECIMALS;
  const amountIn = parseQuoteAmount(amount, payDecimals);

  const swap = useMemo(() => {
    if (!market || amountIn == null) return null;
    const pool = {
      sqrtPriceX96: market.sqrtPriceX96,
      liquidity: market.liquidity,
      tokenIsCurrency0: market.tokenIsCurrency0,
      sqrtLowerX96: market.sqrtLowerX96,
      sqrtUpperX96: market.sqrtUpperX96,
      tickSpacing: market.tickSpacing,
      tradeFee: market.tradeFee,
    };
    return isBuy
      ? quoteBuy({ ...pool, swapFee: market.buySwapFee, quoteIn: amountIn })
      : quoteSell({ ...pool, swapFee: market.sellSwapFee, tokensIn: amountIn });
  }, [market, amountIn, isBuy]);

  const out = swap ? (isBuy ? swap.tokensOut : swap.quoteOut) : null;
  const formatOut = (raw) => (isBuy ? formatSupply(raw) : formatPrecise(raw, quote.decimals));
  const receive = out == null ? "0" : formatOut(out);
  const minOut = out == null ? null : minimumReceived(out, slippagePct);
  const impactPct = swap ? swap.priceImpact * 100 : null;
  // The launch's trade fee, always in the quote: off the payment on a buy, out of
  // the proceeds on a sell.
  const feePct = market?.tradeFee != null ? formatTradeFee(market.tradeFee) : null;
  const feeAmount = swap && out ? swap.fee : null;
  // With a trade fee, a buy the range cannot fill in full reverts (quoted as
  // nothing out); a sell, or a buy in a zero-fee pool, fills partly.
  const buyCannotFill = isBuy && swap?.exceedsRange && !out;

  const onSide = (next) => {
    setSide(next);
    setAmount("");
    setSubmitted(false);
    reset();
  };

  const available = isBuy ? quoteBalance : tokenBalance;
  const insufficient = amountIn != null && available != null && amountIn > available;

  // One state drives the button: label, whether it is clickable, and what it does.
  let cta;
  if (!router) cta = { label: isBuy ? t("trade.buyCta", { symbol }) : t("trade.sellCta", { symbol }), disabled: true };
  else if (!isConnected) cta = { label: t("trade.connect"), disabled: false, onClick: openLoginModal };
  else if (amountIn == null) cta = { label: t("trade.enterAmount"), disabled: true };
  else if (buyCannotFill) cta = { label: t("trade.tooLarge"), disabled: true };
  else if (insufficient) cta = { label: t("trade.insufficient", { unit: isBuy ? quote.symbol : symbol }), disabled: true };
  else if (isPending) cta = { label: t("trade.pending"), disabled: true };
  else if (!out) cta = { label: t("trade.enterAmount"), disabled: true };
  else {
    cta = {
      label: isBuy ? t("trade.buyCta", { symbol }) : t("trade.sellCta", { symbol }),
      disabled: !address,
      onClick: async () => {
        setSubmitted(false);
        try {
          await trade({ side, token, quoteToken: quote.address, amountIn, minOut });
          setAmount("");
          setSubmitted(true);
        } catch {
          // Surfaced from the mutation's `error` below.
        }
      },
    };
  }

  const presets = isBuy
    ? buyPresets.map((v) => ({ label: v, value: v }))
    : SELL_PRESETS.map((pct) => ({
        label: pct === 100 ? t("common:max", { defaultValue: "Max" }) : `${pct}%`,
        value: tokenBalance ? formatUnits((tokenBalance * BigInt(pct)) / 100n, TOKEN_DECIMALS) : "",
      }));

  const payUnit = isBuy ? quote.symbol : symbol;
  const getUnit = isBuy ? symbol : quote.symbol;
  const balanceLabel = isBuy
    ? quoteBalance != null ? `${formatPrecise(quoteBalance, quote.decimals)} ${quote.symbol}` : "—"
    : `${formatSupply(tokenBalance ?? 0n)} ${symbol}`;
  const price = market ? formatTokenPrice(market.fdv, quote) : null;

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
            <dd>{price ? t("trade.priceValue", { price: price.value, unit: price.unit, symbol }) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.priceImpact")}</dt>
            <dd className={impactPct != null && impactPct >= 5 ? "text-destructive" : undefined} data-testid="trade-impact">
              {impactPct == null ? "—" : `${impactPct.toFixed(2)}%`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.tradeFee")}</dt>
            <dd data-testid="trade-fee">
              {feePct == null
                ? "—"
                : feeAmount != null
                  ? t("trade.tradeFeeValue", { amount: formatPrecise(feeAmount, quote.decimals), quote: quote.symbol, fee: feePct })
                  : `${feePct}%`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("trade.minReceived")}</dt>
            <dd>
              {minOut == null ? "—" : `${formatOut(minOut)} ${getUnit}`}
            </dd>
          </div>
        </dl>

        {swap?.exceedsRange && (
          <p className="text-xs text-fabric-red">
            {isBuy ? t(buyCannotFill ? "trade.exceedsBuy" : "trade.exceedsBuyPartial") : t("trade.exceedsSell")}
          </p>
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
  /** The launch's quote token ({ address, symbol, decimals }) until the market is read. */
  quote: PropTypes.shape({ address: PropTypes.string, symbol: PropTypes.string, decimals: PropTypes.number }),
  className: PropTypes.string,
};

export default BuyPanel;
