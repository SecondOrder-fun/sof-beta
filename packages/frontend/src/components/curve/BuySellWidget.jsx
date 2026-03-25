// src/components/curve/BuySellWidget.jsx
import PropTypes from "prop-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { buildPublicClient } from "@/lib/viemClient";
import { useAccount } from "wagmi";
import { useSofDecimals } from "@/hooks/useSofDecimals";
import { useSOFToken } from "@/hooks/useSOFToken";
import {
  useFormatSOF,
  usePriceEstimation,
  useTradingLockStatus,
  useBalanceValidation,
  useBuySellTransactions,
  useTransactionHandlers,
} from "@/hooks/buysell";
import {
  SlippageSettings,
  TradingStatusOverlay,
} from "@/components/buysell";

const BuySellWidget = ({
  bondingCurveAddress,
  onTxSuccess,
  onNotify,
  initialTab,
  isGated = false,
  isVerified = null,
  onGatingRequired,
}) => {
  const { t } = useTranslation(["common", "transactions"]);
  const sofDecimalsState = useSofDecimals();
  const decimalsReady =
    typeof sofDecimalsState === "number" && !Number.isNaN(sofDecimalsState);
  const sofDecimals = decimalsReady ? sofDecimalsState : 18;
  const formatSOF = useFormatSOF(sofDecimals);
  const { address: connectedAddress } = useAccount();
  const {
    balance: sofBalance = "0",
    isLoading: isBalanceLoading,
  } = useSOFToken();

  // Tab state with localStorage persistence
  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === "buy" || initialTab === "sell") {
      return initialTab;
    }
    try {
      const saved = localStorage.getItem("buySell.activeTab");
      if (saved === "buy" || saved === "sell") return saved;
    } catch {
      // no-op
    }
    return "buy";
  });

  const [buyAmount, setBuyAmount] = useState("");
  const [sellAmount, setSellAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState("1"); // 1%
  const [showSettings, setShowSettings] = useState(false);

  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const client = useMemo(() => {
    if (!net?.rpcUrl) return null;
    return buildPublicClient(netKey);
  }, [net?.rpcUrl, netKey]);

  // Shared hooks
  const { tradingLocked, buyFeeBps, sellFeeBps } = useTradingLockStatus(
    client,
    bondingCurveAddress
  );

  const { buyEstBase: _buyEstBase, sellEstBase: _sellEstBase, estBuyWithFees, estSellAfterFees } =
    usePriceEstimation(
      client,
      bondingCurveAddress,
      buyAmount,
      sellAmount,
      buyFeeBps,
      sellFeeBps
    );

  const { hasInsufficientBalance, hasZeroBalance } = useBalanceValidation(
    sofBalance,
    sofDecimals,
    estBuyWithFees,
    isBalanceLoading
  );

  const { executeBuy, executeSell, isPending } = useBuySellTransactions(
    bondingCurveAddress,
    client,
    onNotify,
    onTxSuccess
  );

  const { handleBuy, handleSell, fetchMaxSellable } = useTransactionHandlers({
    client,
    bondingCurveAddress,
    connectedAddress,
    tradingLocked,
    hasZeroBalance,
    hasInsufficientBalance,
    formatSOF,
    onNotify,
    executeBuy,
    executeSell,
    estBuyWithFees,
    estSellAfterFees,
    slippagePct,
    isGated,
    isVerified,
    onGatingRequired,
  });

  // Persist active tab in localStorage
  useEffect(() => {
    if (initialTab === "buy" || initialTab === "sell") return;
    try {
      const saved = localStorage.getItem("buySell.activeTab");
      if (saved === "buy" || saved === "sell") setActiveTab(saved);
    } catch {
      /* no-op */
    }
  }, [initialTab]);

  useEffect(() => {
    try {
      localStorage.setItem("buySell.activeTab", activeTab);
    } catch {
      /* no-op */
    }
  }, [activeTab]);

  const onBuy = async (e) => {
    e.preventDefault();
    if (!buyAmount && !needsVerification) return;

    const result = await handleBuy(
      buyAmount ? BigInt(buyAmount) : 0n,
      () => setBuyAmount(""),
    );
    if (result.success) {
      setBuyAmount("");
    }
  };

  const onSell = async (e) => {
    e.preventDefault();
    if (!sellAmount) return;

    const result = await handleSell(BigInt(sellAmount), () => setSellAmount(""));
    if (result.success) {
      setSellAmount("");
    }
  };

  // MAX helper - reads user's position from bonding curve
  const onMaxSell = useCallback(async () => {
    const balance = await fetchMaxSellable();
    setSellAmount(balance.toString());
  }, [fetchMaxSellable]);

  const rpcMissing = !net?.rpcUrl;
  const disabledTip = rpcMissing
    ? "RPC not configured. Set VITE_RPC_URL in env/.env.{network} and restart dev servers."
    : undefined;
  const walletNotConnected = !connectedAddress;
  const needsVerification = isGated && isVerified !== true;

  return (
    <div className="space-y-4 relative">
      <TradingStatusOverlay
        tradingLocked={tradingLocked}
        walletNotConnected={walletNotConnected}
        variant="desktop"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="w-full mb-3 mt-2 grid grid-cols-[2fr,2fr,0.6fr] gap-2 items-center">
          <div className="col-span-2 flex justify-center">
            <TabsList>
              <TabsTrigger value="buy" className="px-8 py-3 text-lg">
                {t("common:buy")}
              </TabsTrigger>
              <TabsTrigger value="sell" className="px-8 py-3 text-lg">
                {t("common:sell")}
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center text-xl rounded hover:bg-muted"
              onClick={() => setShowSettings((s) => !s)}
              title="Slippage settings"
            >
              ⚙︎
            </button>
          </div>
          {showSettings && (
            <SlippageSettings
              slippagePct={slippagePct}
              onSlippageChange={setSlippagePct}
              onClose={() => setShowSettings(false)}
              variant="desktop"
            />
          )}
        </div>

        <TabsContent value="buy">
          <form className="space-y-2" onSubmit={onBuy}>
            <div className="font-medium">
              {t("common:amount", { defaultValue: "Amount" })}
            </div>
            <Input
              type="number"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              placeholder={t("common:amount", { defaultValue: "Amount" })}
            />
            <div className="text-xs text-muted-foreground">
              {t("common:estimatedCost", { defaultValue: "Estimated cost" })}:{" "}
              <span className="font-mono">{formatSOF(estBuyWithFees)}</span> SOF
            </div>
            <Button
              type="submit"
              disabled={
                rpcMissing ||
                isPending ||
                tradingLocked ||
                walletNotConnected ||
                (!needsVerification && (
                  !buyAmount ||
                  hasZeroBalance ||
                  hasInsufficientBalance
                ))
              }
              className="w-full"
              title={
                tradingLocked
                  ? "Trading is locked"
                  : walletNotConnected
                    ? "Connect wallet first"
                    : !needsVerification && (hasZeroBalance || hasInsufficientBalance)
                      ? t("transactions:insufficientSOFShort", {
                          defaultValue: "Insufficient $SOF balance",
                        })
                      : disabledTip
              }
            >
              {isPending
                ? t("transactions:buying")
                : needsVerification
                  ? t("raffle:verifyAccess", { defaultValue: "Verify Access" })
                  : t("common:buy")}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="sell">
          <form className="space-y-2" onSubmit={onSell}>
            <div className="font-medium">
              {t("common:amount", { defaultValue: "Amount" })}
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                value={sellAmount}
                onChange={(e) => setSellAmount(e.target.value)}
                placeholder={t("common:amount", { defaultValue: "Amount" })}
              />
              <Button
                type="button"
                variant="outline"
                onClick={onMaxSell}
                disabled={!connectedAddress}
                title={
                  connectedAddress
                    ? t("common:max", { defaultValue: "Max" })
                    : "Connect wallet"
                }
              >
                MAX
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("common:estimatedProceeds", {
                defaultValue: "Estimated proceeds",
              })}
              : <span className="font-mono">{formatSOF(estSellAfterFees)}</span>{" "}
              SOF
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={
                rpcMissing ||
                !sellAmount ||
                isPending ||
                tradingLocked ||
                walletNotConnected
              }
              className="w-full"
              title={
                tradingLocked
                  ? "Trading is locked"
                  : walletNotConnected
                    ? "Connect wallet first"
                    : disabledTip
              }
            >
              {isPending ? t("transactions:selling") : t("common:sell")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
};

BuySellWidget.propTypes = {
  bondingCurveAddress: PropTypes.string,
  onTxSuccess: PropTypes.func,
  onNotify: PropTypes.func,
  initialTab: PropTypes.oneOf(["buy", "sell"]),
  isGated: PropTypes.bool,
  isVerified: PropTypes.bool,
  onGatingRequired: PropTypes.func,
};

export default BuySellWidget;
