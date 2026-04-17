/**
 * Buy/Sell Bottom Sheet
 * Bottom sheet modal for Buy/Sell transactions
 */

import PropTypes from "prop-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Settings } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { buildPublicClient } from "@/lib/viemClient";
import { useSofDecimals } from "@/hooks/useSofDecimals";
import { useSOFToken } from "@/hooks/useSOFToken";
import { useAccount } from "wagmi";
import {
  useFormatSOF,
  usePriceEstimation,
  useTradingLockStatus,
  useBalanceValidation,
  useBuySellTransactions,
  useSeasonValidation,
  useTransactionHandlers,
} from "@/hooks/buysell";
import {
  BuyForm,
  SellForm,
  SlippageSettings,
  TradingStatusOverlay,
} from "@/components/buysell";
import { useRollover } from "@/hooks/useRollover";
import RolloverBanner from "@/components/curve/RolloverBanner";
import { Button } from "@/components/ui/button";
import { SOFBondingCurveAbi } from "@/utils/abis";
import { useToast } from "@/hooks/useToast";
import { useStaggeredRefresh } from "@/hooks/useStaggeredRefresh";

export const BuySellSheet = ({
  open,
  onOpenChange,
  mode = "buy",
  seasonId,
  seasonStatus,
  seasonEndTime,
  bondingCurveAddress,
  maxSellable = 0n,
  onSuccess,
  onNotify,
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

  const [activeTab, setActiveTab] = useState(() => {
    if (mode === "buy" || mode === "sell") {
      return mode;
    }
    return "buy";
  });

  const [quantityInput, setQuantityInput] = useState("1");
  const [isLoading, setIsLoading] = useState(false);
  const [slippagePct, setSlippagePct] = useState("1");
  const [showSettings, setShowSettings] = useState(false);
  const [ticketPosition, setTicketPosition] = useState(null);
  const { toast } = useToast();

  // Rollover state
  const [rolloverEnabled, setRolloverEnabled] = useState(true);
  const [rolloverAmountOverride, setRolloverAmountOverride] = useState(null);

  // Sync activeTab with mode prop when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(mode);
    }
  }, [open, mode]);

  const parsedQuantity = useMemo(() => {
    const n = Number(quantityInput);
    if (!Number.isFinite(n)) return null;
    return Math.floor(n);
  }, [quantityInput]);

  const isQuantityValid = parsedQuantity !== null && parsedQuantity >= 1;

  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const client = useMemo(() => {
    if (!net?.rpcUrl) return null;
    return buildPublicClient(net.rpcUrl, net.chainId ?? net.id);
  }, [net]);

  // Fetch user's ticket position (balance + win probability)
  const refreshPosition = useCallback(async () => {
    if (!client || !connectedAddress || !bondingCurveAddress) return;
    try {
      const [tickets, cfg] = await Promise.all([
        client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "playerTickets",
          args: [connectedAddress],
        }),
        client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "curveConfig",
          args: [],
        }),
      ]);
      const t = BigInt(tickets ?? 0n);
      const total = BigInt(cfg?.[0] ?? 0n);
      const probBps = total > 0n ? Number((t * 10000n) / total) : 0;
      setTicketPosition({ tickets: t, total, probBps });
    } catch {
      // Silently fail — position display is informational
    }
  }, [client, connectedAddress, bondingCurveAddress]);

  // Staggered refresh for post-tx position updates
  const triggerStaggeredRefresh = useStaggeredRefresh([refreshPosition]);

  // Load position when sheet opens
  useEffect(() => {
    if (open) refreshPosition();
  }, [open, refreshPosition]);

  // Rollover hook
  const {
    rolloverBalance,
    bonusBps,
    bonusAmount,
    isRolloverAvailable,
  } = useRollover(seasonId);

  // Shared hooks
  const { tradingLocked, buyFeeBps, sellFeeBps } = useTradingLockStatus(
    client,
    bondingCurveAddress
  );

  const { maxBuyable, seasonTimeNotActive } = useSeasonValidation(
    client,
    bondingCurveAddress,
    seasonStatus,
    seasonEndTime,
    open
  );

  const { buyEstBase: _buyEstBase, sellEstBase: _sellEstBase, estBuyWithFees, estSellAfterFees } =
    usePriceEstimation(
      client,
      bondingCurveAddress,
      isQuantityValid ? String(parsedQuantity) : "0",
      isQuantityValid ? String(parsedQuantity) : "0",
      buyFeeBps,
      sellFeeBps
    );

  const { hasInsufficientBalance, hasZeroBalance } = useBalanceValidation(
    sofBalance,
    sofDecimals,
    estBuyWithFees,
    isBalanceLoading
  );

  // Computed rollover amount: override takes precedence, otherwise auto-deplete up to estBuyWithFees
  const rolloverAmount = rolloverAmountOverride ?? (
    isRolloverAvailable && rolloverEnabled
      ? (rolloverBalance < estBuyWithFees ? rolloverBalance : estBuyWithFees)
      : 0n
  );

  const txSuccessCallback = useCallback(() => {
    onSuccess?.({ mode: activeTab, quantity: parsedQuantity, seasonId });
    onOpenChange(false);
  }, [activeTab, parsedQuantity, seasonId, onSuccess, onOpenChange]);

  const { executeBuy, executeSell } = useBuySellTransactions(
    bondingCurveAddress,
    client,
    onNotify,
    txSuccessCallback
  );

  const { handleBuy, handleSell, fetchMaxSellable } = useTransactionHandlers({
    client,
    bondingCurveAddress,
    connectedAddress,
    tradingLocked,
    seasonTimeNotActive,
    hasZeroBalance,
    hasInsufficientBalance,
    formatSOF,
    onNotify,
    executeBuy,
    executeSell,
    estBuyWithFees,
    estSellAfterFees,
    slippagePct,
    rolloverEnabled: isRolloverAvailable && rolloverEnabled,
    rolloverAmount,
    rolloverSeasonId: seasonId,
  });

  const exceedsRemainingSupply =
    maxBuyable !== null && isQuantityValid ? parsedQuantity > maxBuyable : false;

  const onBuy = async (e) => {
    e.preventDefault();
    if (!isQuantityValid) return;

    setIsLoading(true);
    try {
      const result = await handleBuy(BigInt(parsedQuantity), () => setQuantityInput("1"));
      if (result?.success) {
        triggerStaggeredRefresh();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onSell = async (e) => {
    e.preventDefault();
    if (!isQuantityValid) return;

    setIsLoading(true);
    try {
      const result = await handleSell(BigInt(parsedQuantity), () => setQuantityInput("1"));
      if (result?.success) {
        triggerStaggeredRefresh();
      } else if (result && !result.success) {
        toast({
          variant: "destructive",
          title: t("transactions:sellFailed", { defaultValue: "Sale failed" }),
          description: result.error || t("common:tryAgain", { defaultValue: "Please try again." }),
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // MAX helper - reads user's position from bonding curve
  const onMaxSell = useCallback(async () => {
    const balance = await fetchMaxSellable();
    setQuantityInput(`${Number(balance)}`);
  }, [fetchMaxSellable]);

  const rpcMissing = !net?.rpcUrl;
  const disabledTip = rpcMissing
    ? "RPC not configured. Set VITE_RPC_URL in env/.env.{network} and restart dev servers."
    : undefined;
  const walletNotConnected = !connectedAddress;

  // Buy button disabled logic
  const buyDisabled =
    rpcMissing ||
    !isQuantityValid ||
    maxBuyable === null ||
    maxBuyable < 1 ||
    exceedsRemainingSupply ||
    isLoading ||
    tradingLocked ||
    seasonTimeNotActive ||
    walletNotConnected ||
    hasZeroBalance ||
    hasInsufficientBalance;

  const buyDisabledReason = seasonTimeNotActive
    ? "Season is not active"
    : tradingLocked
      ? "Trading is locked"
      : walletNotConnected
        ? "Connect wallet first"
        : hasZeroBalance || hasInsufficientBalance
          ? t("transactions:insufficientSOFShort", {
              defaultValue: "Insufficient $SOF balance",
            })
          : disabledTip;

  // Sell button disabled logic
  const sellDisabled =
    rpcMissing ||
    !isQuantityValid ||
    isLoading ||
    tradingLocked ||
    seasonTimeNotActive ||
    walletNotConnected ||
    maxSellable === 0n;

  const sellDisabledReason = seasonTimeNotActive
    ? "Season is not active"
    : tradingLocked
      ? "Trading is locked"
      : walletNotConnected
        ? "Connect wallet first"
        : maxSellable === 0n
          ? "No tickets to sell"
          : disabledTip;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-background border-t-2 border-primary rounded-t-2xl px-3 max-w-screen-sm mx-auto"
      >
        <SheetHeader className="mb-6">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-xl font-bold">
                {activeTab === "buy" ? "Buy Tickets" : "Sell Tickets"}
              </SheetTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <SheetDescription className="sr-only">
              {activeTab === "buy" ? "Buy tickets" : "Sell tickets"}
            </SheetDescription>
          </div>
        </SheetHeader>

        <TradingStatusOverlay
          tradingLocked={tradingLocked}
          walletNotConnected={walletNotConnected}
          variant="mobile"
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full mb-2">
            <TabsTrigger value="buy" className="flex-1">
              BUY
            </TabsTrigger>
            <TabsTrigger value="sell" className="flex-1">
              SELL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="space-y-6">
            {isRolloverAvailable && (
              <RolloverBanner
                rolloverBalance={rolloverBalance}
                bonusBps={bonusBps}
                bonusAmount={bonusAmount}
                sourceSeasonId={seasonId}
                enabled={rolloverEnabled}
                onEnabledChange={setRolloverEnabled}
                rolloverAmount={rolloverAmount}
                onRolloverAmountChange={setRolloverAmountOverride}
              />
            )}
            <BuyForm
              quantityInput={quantityInput}
              onQuantityChange={setQuantityInput}
              maxBuyable={maxBuyable}
              estBuyWithFees={estBuyWithFees}
              buyFeeBps={buyFeeBps}
              formatSOF={formatSOF}
              onSubmit={onBuy}
              isLoading={isLoading}
              disabled={buyDisabled}
              disabledReason={buyDisabledReason}
              ticketPosition={ticketPosition}
              settingsButton={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSettings(!showSettings)}
                  className="h-12 w-12 shrink-0"
                  title="Slippage settings"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              }
              settingsPanel={
                <AnimatePresence initial={false}>
                  {showSettings && (
                    <motion.div
                      key="slippage"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <SlippageSettings
                        slippagePct={slippagePct}
                        onSlippageChange={setSlippagePct}
                        onClose={() => setShowSettings(false)}
                        variant="mobile"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              }
            />
          </TabsContent>

          <TabsContent value="sell" className="space-y-6">
            <SellForm
              quantityInput={quantityInput}
              onQuantityChange={setQuantityInput}
              maxSellable={maxSellable}
              estSellAfterFees={estSellAfterFees}
              sellFeeBps={sellFeeBps}
              formatSOF={formatSOF}
              onSubmit={onSell}
              onMaxClick={onMaxSell}
              isLoading={isLoading}
              disabled={sellDisabled}
              disabledReason={sellDisabledReason}
              connectedAddress={connectedAddress}
              ticketPosition={ticketPosition}
              settingsButton={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSettings(!showSettings)}
                  className="h-12 w-12 shrink-0"
                  title="Slippage settings"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              }
              settingsPanel={
                <AnimatePresence initial={false}>
                  {showSettings && (
                    <motion.div
                      key="slippage"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <SlippageSettings
                        slippagePct={slippagePct}
                        onSlippageChange={setSlippagePct}
                        onClose={() => setShowSettings(false)}
                        variant="mobile"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              }
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

BuySellSheet.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  mode: PropTypes.oneOf(["buy", "sell"]),
  seasonId: PropTypes.number,
  seasonStatus: PropTypes.any,
  seasonEndTime: PropTypes.any,
  bondingCurveAddress: PropTypes.string,
  maxSellable: PropTypes.bigint,
  onSuccess: PropTypes.func,
  onNotify: PropTypes.func,
};

export default BuySellSheet;
