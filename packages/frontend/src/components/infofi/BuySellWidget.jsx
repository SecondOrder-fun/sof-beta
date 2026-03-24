// src/components/infofi/BuySellWidget.jsx
import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { useAccount } from 'wagmi';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/useToast';
import { placeBetTx, readBet } from '@/services/onchainInfoFi';

import { useFormatSOF } from '@/hooks/buysell';
import { TrendingUp, TrendingDown } from 'lucide-react';

/**
 * BuySellWidget Component
 * Polymarket-style trading interface for prediction markets
 * Allows users to buy YES or NO positions
 */
const BuySellWidget = ({ marketId, market }) => {
  const { t } = useTranslation('market');
  const { isConnected, address } = useAccount();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = React.useState('buy');
  const [outcome, setOutcome] = React.useState('YES');
  const [amount, setAmount] = React.useState('');

  // Read user's current positions
  const yesPosition = useQuery({
    queryKey: ['infofiBet', marketId, address, true],
    enabled: !!address && !!marketId,
    queryFn: () => readBet({ marketId, account: address, prediction: true }),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  const noPosition = useQuery({
    queryKey: ['infofiBet', marketId, address, false],
    enabled: !!address && !!marketId,
    queryFn: () => readBet({ marketId, account: address, prediction: false }),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  // Place bet mutation
  const placeBet = useMutation({
    mutationFn: async () => {
      const amt = amount || '0';
      return placeBetTx({ 
        marketId, 
        prediction: outcome === 'YES', 
        amount: amt,
        seasonId: market?.raffle_id || market?.seasonId,
        player: market?.player
      });
    },
    onSuccess: (hash) => {
      qc.invalidateQueries({ queryKey: ['infofiBet', marketId, address, true] });
      qc.invalidateQueries({ queryKey: ['infofiBet', marketId, address, false] });
      yesPosition.refetch?.();
      noPosition.refetch?.();
      setAmount('');
      toast({ 
        title: t('betConfirmed'), 
        description: t('betDetails', { 
          side: outcome, 
          amount, 
          hash: String(hash) 
        }) 
      });
    },
    onError: (e) => {
      toast({ 
        title: t('tradeFailed'), 
        description: e?.message || t('transactionError'), 
        variant: 'destructive' 
      });
    }
  });

  // Calculate current odds
  const yesOdds = ((market?.current_probability || 0) / 100).toFixed(1);
  const noOdds = (100 - (market?.current_probability || 0) / 100).toFixed(1);

  // Calculate potential payout
  const calculatePayout = React.useCallback((betAmount, isYes) => {
    const amt = Number(betAmount || 0);
    if (amt <= 0) return 0;
    
    const odds = isYes ? Number(yesOdds) : Number(noOdds);
    if (odds === 0) return 0;
    
    return (amt / (odds / 100));
  }, [yesOdds, noOdds]);

  const potentialPayout = calculatePayout(amount, outcome === 'YES');
  const potentialProfit = potentialPayout - Number(amount || 0);

  // Format SOF amounts using shared hook
  const formatSOF = useFormatSOF(18); // SOF uses 18 decimals

  const yesAmount = formatSOF(yesPosition.data?.amount ?? 0n);
  const noAmount = formatSOF(noPosition.data?.amount ?? 0n);

  return (
    <Card className="sticky top-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('trade')}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Buy/Sell tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="buy" className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              {t('buy')}
            </TabsTrigger>
            <TabsTrigger value="sell" className="flex items-center gap-1">
              <TrendingDown className="h-4 w-4" />
              {t('sell')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="space-y-4 mt-4">
            {/* Outcome selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOutcome('YES')}
                className={`relative overflow-hidden rounded-lg border-2 transition-all p-4 ${
                  outcome === 'YES' 
                    ? 'border-emerald-500 bg-emerald-50' 
                    : 'border-gray-200 hover:border-emerald-300 bg-white'
                }`}
              >
                <div className="absolute inset-0 bg-emerald-100" style={{ width: `${yesOdds}%` }} />
                <div className="relative flex flex-col items-center">
                  <span className="text-2xl font-bold text-emerald-700">{yesOdds}%</span>
                  <span className="text-xs font-medium text-emerald-900 mt-1">{t('yes')}</span>
                </div>
              </button>
              
              <button
                onClick={() => setOutcome('NO')}
                className={`relative overflow-hidden rounded-lg border-2 transition-all p-4 ${
                  outcome === 'NO' 
                    ? 'border-rose-500 bg-rose-50' 
                    : 'border-gray-200 hover:border-rose-300 bg-white'
                }`}
              >
                <div className="absolute inset-0 bg-rose-100" style={{ width: `${noOdds}%` }} />
                <div className="relative flex flex-col items-center">
                  <span className="text-2xl font-bold text-rose-700">{noOdds}%</span>
                  <span className="text-xs font-medium text-rose-900 mt-1">{t('no')}</span>
                </div>
              </button>
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('amount')}</label>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-lg"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('balance')}: 0.00 SOF</span>
                <button className="text-primary hover:underline">{t('max')}</button>
              </div>
            </div>

            {/* Payout preview */}
            {amount && Number(amount) > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('potentialPayout')}</span>
                  <span className="font-semibold">{potentialPayout.toFixed(2)} SOF</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('potentialProfit')}</span>
                  <span className={`font-semibold ${potentialProfit > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    +{potentialProfit.toFixed(2)} SOF
                  </span>
                </div>
              </div>
            )}

            {/* Buy button */}
            <Button
              onClick={() => placeBet.mutate()}
              disabled={!isConnected || !amount || placeBet.isPending}
              className={`w-full ${
                outcome === 'YES' 
                  ? 'bg-emerald-600 hover:bg-emerald-700' 
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
              size="lg"
            >
              {placeBet.isPending 
                ? t('submitting') 
                : isConnected 
                  ? `${t('buy')} ${outcome}` 
                  : t('connectWallet')
              }
            </Button>
          </TabsContent>

          <TabsContent value="sell" className="space-y-4 mt-4">
            <div className="text-sm text-muted-foreground text-center py-8">
              {t('sellComingSoon')}
            </div>
          </TabsContent>
        </Tabs>

        {/* User positions */}
        {isConnected && (yesAmount !== '0' || noAmount !== '0') && (
          <div className="border-t pt-4 space-y-2">
            <div className="text-sm font-medium text-muted-foreground">{t('yourPositions')}</div>
            <div className="grid grid-cols-2 gap-2">
              {yesAmount !== '0' && (
                <div className="flex items-center justify-between text-xs bg-emerald-50 rounded px-2 py-1.5">
                  <span className="text-emerald-700 font-medium">{t('yes')}</span>
                  <span className="font-mono font-semibold text-emerald-900">{yesAmount}</span>
                </div>
              )}
              {noAmount !== '0' && (
                <div className="flex items-center justify-between text-xs bg-rose-50 rounded px-2 py-1.5">
                  <span className="text-rose-700 font-medium">{t('no')}</span>
                  <span className="font-mono font-semibold text-rose-900">{noAmount}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Terms notice */}
        <div className="text-xs text-muted-foreground text-center">
          {t('byTradingYouAgree')}{' '}
          <a href="/terms" className="text-primary hover:underline">
            {t('termsOfUse')}
          </a>
        </div>
      </CardContent>
    </Card>
  );
};

BuySellWidget.propTypes = {
  marketId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  market: PropTypes.shape({
    current_probability: PropTypes.number,
    raffle_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    player: PropTypes.string,
  }),
};

export default BuySellWidget;
