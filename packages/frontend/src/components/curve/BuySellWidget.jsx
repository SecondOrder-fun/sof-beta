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
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
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
import { useEligibleRolloverCohort } from "@/hooks/useEligibleRolloverCohort";
import { computeBuySplit } from "@/hooks/buysell/computeBuySplit";
import { applyMaxSlippage } from "@/utils/buysell/slippage";
import RolloverBanner from "./RolloverBanner";

const BuySellWidget = ({
  bondingCurveAddress,
  onTxSuccess,
  onNotify,
  initialTab,
  isGated = false,
  isVerified = null,
  onGatingRequired,
  seasonId,
}) => {
  const { t } = useTranslation(["common", "transactions"]);
  const sofDecimalsState = useSofDecimals();
  const decimalsReady =
    typeof sofDecimalsState === "number" && !Number.isNaN(sofDecimalsState);
  const sofDecimals = decimalsReady ? sofDecimalsState : 18;
  const formatSOF = useFormatSOF(sofDecimals);
  // Connection state comes from the EOA (whether wallet is plugged in).
  // All ticket/balance reads use the SMA — that's the on-chain identity for
  // gameplay state per the M3 read-migration. `connectedAddress` (the
  // address we feed into bondingCurve.playerTickets etc.) MUST be the SMA,
  // not the EOA, or those reads return 0 for SMA-funded users.
  const { address: eoaAddress } = useAccount();
  const { sma: smaAddress } = useRaffleAccount();
  const connectedAddress = smaAddress;
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

  // Rollover state
  const [rolloverEnabled, setRolloverEnabled] = useState(true);
  const [rolloverAmountOverride, setRolloverAmountOverride] = useState(null);

  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const client = useMemo(() => {
    if (!net?.rpcUrl) return null;
    return buildPublicClient(netKey);
  }, [net?.rpcUrl, netKey]);

  // Rollover-spend lookup: find the cohort funding a buy in this season.
  // Per the N→N+1 rule, it's exactly cohort (seasonId - 1n) when active.
  const {
    cohortSeasonId,
    available: rolloverBalance,
    bonusBps,
    bonusAmount,
    isEligible: isRolloverAvailable,
  } = useEligibleRolloverCohort(seasonId != null ? BigInt(seasonId) : 0n);

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

  // Computed rollover amount: override takes precedence, otherwise auto-deplete up to estBuyWithFees
  const rolloverAmount = rolloverAmountOverride ?? (
    isRolloverAvailable && rolloverEnabled
      ? (rolloverBalance < estBuyWithFees ? rolloverBalance : estBuyWithFees)
      : 0n
  );

  // Split the requested ticket count across rollover + wallet portions.
  // computeBuySplit handles the all-rollover, all-wallet, and mixed cases.
  const { walletTopupTickets, walletTopupSofBase } = useMemo(
    () =>
      computeBuySplit({
        tokenAmount: (() => {
          try {
            return BigInt(buyAmount || "0");
          } catch {
            return 0n;
          }
        })(),
        estBuyWithFees,
        rolloverAmount,
      }),
    [buyAmount, estBuyWithFees, rolloverAmount]
  );

  // Apply slippage to the wallet-topup base for the maxSof cap.
  const walletTopupMaxSof = useMemo(
    () => applyMaxSlippage(walletTopupSofBase, slippagePct),
    [walletTopupSofBase, slippagePct]
  );

  // Effective rollover SOF (base + bonus) available to the balance check.
  const rolloverEffectiveAmount = useMemo(
    () =>
      isRolloverAvailable && rolloverEnabled
        ? rolloverAmount + bonusAmount(rolloverAmount)
        : 0n,
    [isRolloverAvailable, rolloverEnabled, rolloverAmount, bonusAmount]
  );

  const { hasInsufficientBalance, hasZeroBalance } = useBalanceValidation(
    sofBalance,
    sofDecimals,
    estBuyWithFees,
    isBalanceLoading,
    rolloverEffectiveAmount,
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
    rolloverEnabled: isRolloverAvailable && rolloverEnabled,
    rolloverAmount,
    rolloverSeasonId: cohortSeasonId,
    walletTopupTickets,
    walletTopupMaxSof,
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
  // "Wallet not connected" means the EOA isn't plugged in. The SMA may take
  // a moment to resolve after connect — that's covered by isBalanceLoading.
  const walletNotConnected = !eoaAddress;
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
          {isRolloverAvailable && (
            <RolloverBanner
              rolloverBalance={rolloverBalance}
              bonusBps={bonusBps}
              bonusAmount={bonusAmount}
              sourceSeasonId={cohortSeasonId}
              enabled={rolloverEnabled}
              onEnabledChange={setRolloverEnabled}
              rolloverAmount={rolloverAmount}
              onRolloverAmountChange={setRolloverAmountOverride}
              estBuyWithFees={estBuyWithFees}
              walletTopupSof={walletTopupSofBase}
              walletTopupTickets={walletTopupTickets}
            />
          )}
          <form className="space-y-2" onSubmit={onBuy}>
            <div className="font-medium">
              {t("common:amount", { defaultValue: "Amount" })}
            </div>
            <Input
              type="number"
              min="1"
              step="1"
              value={buyAmount}
              onChange={(e) => {
                const v = e.target.value;
                // Clamp to non-negative integers; allow empty for placeholder UX.
                if (v === "" || (/^\d+$/.test(v) && Number(v) >= 1)) setBuyAmount(v);
              }}
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
                  Number(buyAmount) < 1 ||
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
                min="1"
                step="1"
                value={sellAmount}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || (/^\d+$/.test(v) && Number(v) >= 1)) setSellAmount(v);
                }}
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
                Number(sellAmount) < 1 ||
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
  seasonId: PropTypes.any,
};

export default BuySellWidget;
