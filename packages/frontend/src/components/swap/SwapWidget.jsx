import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { ArrowUpDown } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSwapProvider } from '@/hooks/swap/useSwapProvider';
import { useSwapTransaction } from '@/hooks/swap/useSwapTransaction';
import { useSOFToken } from '@/hooks/useSOFToken';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import TokenSelector from './TokenSelector';

const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Build the token list from contract addresses.
 */
function buildTokenList(contracts) {
  return [
    { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 },
    { address: contracts.USDC, symbol: 'USDC', decimals: 6 },
    { address: contracts.SOF, symbol: '$SOF', decimals: 18 },
  ].filter((t) => t.address);
}

/**
 * SwapWidget — main interface for buying and selling $SOF.
 *
 * Supports:
 * - Token selector for tokenIn (ETH, USDC, $SOF)
 * - Computed tokenOut (the opposite side)
 * - Direction toggle (buy/sell SOF)
 * - Amount input with Max button
 * - Live quote display
 * - Daily sell-limit indicator when selling SOF
 * - Swap button with pending state
 */
const SwapWidget = () => {
  const { t } = useTranslation('swap');
  const { address, isConnected } = useAccount();
  const contracts = getContractAddresses(getStoredNetworkKey());
  // Memoize on the underlying address strings rather than the object
  // identity — getContractAddresses returns a fresh object every render,
  // so without this the quote effect re-fires every render and the 400ms
  // debounce becomes a 400ms strobe.
  const tokens = useMemo(
    () => buildTokenList(contracts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contracts.USDC, contracts.SOF],
  );

  const provider = useSwapProvider();
  const exchangeAddress = provider?.exchangeAddress ?? '';
  const { mutateAsync: executeSwap, isPending, isSuccess, isError, error } =
    useSwapTransaction(exchangeAddress);
  const { balance: sofBalance, refetchBalance } = useSOFToken();

  // Default: buy SOF with ETH
  const [tokenIn, setTokenIn] = useState(ETH_ADDRESS);
  const [tokenOut, setTokenOut] = useState(contracts.SOF || '');
  const [amountIn, setAmountIn] = useState('');
  const [estimatedOut, setEstimatedOut] = useState('');
  const [dailyUsage, setDailyUsage] = useState(null);
  const [quoteError, setQuoteError] = useState('');

  const isSellingSOF = tokenIn === contracts.SOF;

  // Tokens available for the "pay" side (all tokens)
  const payTokens = tokens;

  // Derive output token whenever tokenIn changes
  useEffect(() => {
    if (tokenIn === contracts.SOF) {
      // Selling SOF — default output is ETH
      setTokenOut(ETH_ADDRESS);
    } else {
      // Buying SOF
      setTokenOut(contracts.SOF || '');
    }
    setAmountIn('');
    setEstimatedOut('');
    setQuoteError('');
  }, [tokenIn, contracts.SOF]);

  // Fetch quote whenever amount or pair changes
  useEffect(() => {
    if (!provider || !amountIn || parseFloat(amountIn) <= 0) {
      setEstimatedOut('');
      return;
    }

    let cancelled = false;

    const fetchQuote = async () => {
      try {
        setQuoteError('');
        const inToken = tokens.find((t) => t.address === tokenIn);
        const decimals = inToken?.decimals ?? 18;
        const amountInWei = parseUnits(amountIn, decimals);
        const { amountOut } = await provider.getQuote(tokenIn, tokenOut, amountInWei);
        if (!cancelled) {
          const outToken = tokens.find((t) => t.address === tokenOut);
          const outDecimals = outToken?.decimals ?? 18;
          setEstimatedOut(formatUnits(amountOut, outDecimals));
        }
      } catch {
        if (!cancelled) {
          setEstimatedOut('');
          setQuoteError(t('swapError'));
        }
      }
    };

    const timer = setTimeout(fetchQuote, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, tokenIn, tokenOut, amountIn, tokens, t]);

  // Fetch daily usage when selling SOF
  useEffect(() => {
    if (!provider || !isSellingSOF || !address) {
      setDailyUsage(null);
      return;
    }

    provider
      .getDailyUsage(address)
      .then(setDailyUsage)
      .catch(() => setDailyUsage(null));
  }, [provider, isSellingSOF, address]);

  const handleDirectionToggle = useCallback(() => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn('');
    setEstimatedOut('');
    setQuoteError('');
  }, [tokenIn, tokenOut]);

  const handleMax = useCallback(() => {
    if (isSellingSOF) {
      setAmountIn(sofBalance ?? '0');
    }
  }, [isSellingSOF, sofBalance]);

  const handleSwap = useCallback(async () => {
    if (!amountIn || parseFloat(amountIn) <= 0) return;
    try {
      const inToken = tokens.find((t) => t.address === tokenIn);
      const decimals = inToken?.decimals ?? 18;
      const amountInWei = parseUnits(amountIn, decimals);
      await executeSwap({ tokenIn, tokenOut, amountIn: amountInWei });
      setAmountIn('');
      setEstimatedOut('');
      refetchBalance();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Swap transaction error:', err);
    }
  }, [amountIn, tokenIn, tokenOut, tokens, executeSwap, refetchBalance]);

  const isSwapDisabled =
    !isConnected ||
    !amountIn ||
    parseFloat(amountIn) <= 0 ||
    isPending;

  // Format a BigInt SOF amount for display (18 decimals)
  const formatSOFAmount = (bigintVal) => {
    if (bigintVal == null) return '—';
    try {
      return parseFloat(formatUnits(bigintVal, 18)).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
    } catch {
      return '—';
    }
  };

  const inputToken = tokens.find((t) => t.address === tokenIn);
  const outputToken = tokens.find((t) => t.address === tokenOut);

  const formattedBalance = isConnected
    ? Number(sofBalance ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '—';

  // Swap is unavailable when the SOFExchange contract isn't deployed on the
  // active network (currently the case on LOCAL — tracked as a follow-up).
  // Return a degraded card instead of letting every keystroke fire a doomed
  // getQuote call against `address: undefined` and strobe "Swap failed".
  if (!exchangeAddress) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-foreground">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('swapUnavailable',
              'Swap is unavailable on this network — claim from the airdrop on the left, or try a different network.')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <div className="mt-2 flex items-baseline justify-between gap-3 rounded-md border px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('balanceHeader', 'Your $SOF balance:')}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold tabular-nums text-foreground">
              {formattedBalance}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              $SOF
            </span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pay row */}
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t('youPay')}</label>
          <div className="flex gap-2">
            <TokenSelector
              tokens={payTokens}
              value={tokenIn}
              onChange={setTokenIn}
              disabled={isPending}
            />
            <div className="relative flex-1">
              <Input
                type="number"
                min="0"
                step="any"
                placeholder={t('enterAmount')}
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                disabled={isPending}
                className={isSellingSOF ? "pr-14" : ""}
              />
              {isSellingSOF && (
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={isPending}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
                >
                  {t('max')}
                </button>
              )}
            </div>
          </div>
          {isSellingSOF && (
            <p className="text-xs text-muted-foreground">
              {t('swapBalance', '$SOF')}: {parseFloat(sofBalance || '0').toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </p>
          )}
        </div>

        {/* Direction toggle */}
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDirectionToggle}
            disabled={isPending}
            className="rounded-full h-8 w-8 p-0"
            aria-label={t('swap')}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>

        {/* Receive row */}
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t('youReceive')}</label>
          <div className="flex gap-2 items-center">
            <div className="flex h-10 w-36 items-center rounded-md border border-border bg-muted px-3 text-sm font-medium text-foreground">
              {outputToken?.symbol ?? '—'}
            </div>
            <div className="flex-1 flex h-10 items-center rounded-md border border-border bg-muted px-3 text-sm text-muted-foreground">
              {estimatedOut
                ? parseFloat(estimatedOut).toLocaleString(undefined, { maximumFractionDigits: 6 })
                : '—'}
            </div>
          </div>
        </div>

        {/* Rate */}
        {estimatedOut && amountIn && parseFloat(amountIn) > 0 && (
          <div className="text-xs text-muted-foreground flex justify-between">
            <span>{t('rate')}</span>
            <span>
              1 {inputToken?.symbol} ={' '}
              {(parseFloat(estimatedOut) / parseFloat(amountIn)).toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{' '}
              {outputToken?.symbol}
            </span>
          </div>
        )}

        {/* Daily sell limit indicator */}
        {isSellingSOF && dailyUsage && (
          <div className="rounded-md border border-border bg-muted p-3 space-y-1">
            <p className="text-xs font-medium text-foreground">{t('dailyLimit')}</p>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t('remaining')}</span>
              <span>{formatSOFAmount(dailyUsage.remaining)} $SOF</span>
            </div>
          </div>
        )}

        {/* Quote error */}
        {quoteError && (
          <p className="text-xs text-destructive">{quoteError}</p>
        )}

        {/* Transaction feedback */}
        {isSuccess && (
          <p className="text-sm text-center font-medium text-primary">
            {t('swapSuccess')}
          </p>
        )}
        {isError && (
          <p className="text-sm text-center text-destructive">
            {t('swapError')}: {error?.shortMessage ?? error?.message ?? ''}
          </p>
        )}

        {/* Insufficient balance warning */}
        {isSellingSOF &&
          amountIn &&
          parseFloat(amountIn) > parseFloat(sofBalance || '0') && (
            <p className="text-xs text-destructive">{t('insufficientBalance')}</p>
          )}

        {/* Swap button */}
        <Button
          className="w-full"
          onClick={handleSwap}
          disabled={isSwapDisabled}
        >
          {isPending ? t('swapping') : t('swap')}
        </Button>

        {/* Testnet notice */}
        <p className="text-xs text-destructive text-center">
          {t('testnetNotice')}
        </p>

        {/* Not connected hint */}
        {!isConnected && (
          <p className="text-xs text-center text-muted-foreground">
            {t('connectWalletToSwap', 'Connect your wallet to swap')}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default SwapWidget;
