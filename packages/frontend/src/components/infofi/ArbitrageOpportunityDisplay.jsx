// src/components/infofi/ArbitrageOpportunityDisplay.jsx
// Updated: 2025-09-30 15:56 - Fixed all BigInt conversions
import PropTypes from 'prop-types';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, AlertCircle, RefreshCw, Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useArbitrageDetectionLive } from '@/hooks/useArbitrageDetection';

/**
 * ArbitrageOpportunityDisplay
 * 
 * Displays real-time arbitrage opportunities between raffle entry costs
 * and InfoFi prediction market prices. Uses on-chain oracle price updates
 * for live detection.
 * 
 * @param {object} props
 * @param {number|string} props.seasonId - Season ID to monitor
 * @param {string} props.bondingCurveAddress - Bonding curve contract address
 * @param {number} props.minProfitability - Minimum profit threshold (default: 2%)
 */
const ArbitrageOpportunityDisplay = ({ seasonId, bondingCurveAddress, minProfitability = 2 }) => {
  const { t } = useTranslation('market');
  const { opportunities, isLoading, error, isLive, refetch } = useArbitrageDetectionLive(
    seasonId,
    bondingCurveAddress,
    {
      minProfitabilityBps: minProfitability * 100,
      maxResults: 10,
    }
  );

  // Format timestamp for display
  const lastUpdateTime = useMemo(() => {
    if (!opportunities || opportunities.length === 0) return null;
    try {
      const latest = Math.max(...opportunities.map((o) => o.lastUpdated || 0));
      return new Date(latest).toLocaleTimeString();
    } catch (err) {
      // Silent fail for timestamp formatting
      return null;
    }
  }, [opportunities]);

  // Get profitability badge color
  const getProfitabilityColor = (profitability) => {
    if (profitability >= 10) return 'bg-green-600 text-white hover:bg-green-700';
    if (profitability >= 5) return 'bg-green-500 text-white hover:bg-green-600';
    if (profitability >= 3) return 'bg-yellow-500 text-white hover:bg-yellow-600';
    return 'bg-gray-500 text-white hover:bg-gray-600';
  };

  // Handle missing configuration
  if (!seasonId || !bondingCurveAddress) {
    return (
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
        <CardHeader>
          <CardTitle>{t('arbitrageOpportunities')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {t('configurationRequired')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-amber-600" />
            <CardTitle>{t('arbitrageOpportunities')}</CardTitle>
            {isLive && (
              <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
                <Activity className="h-3 w-3 animate-pulse" />
                {t('live')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastUpdateTime && (
              <span className="text-xs text-muted-foreground">
                {t('updated')} {lastUpdateTime}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={refetch}
              disabled={isLoading}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && opportunities.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <RefreshCw className="mx-auto h-8 w-8 animate-spin text-amber-600" />
              <p className="mt-2 text-sm text-muted-foreground">{t('scanningForOpportunities')}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-900">{t('failedToDetectOpportunities')}</p>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          </div>
        )}

        {!isLoading && !error && opportunities.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
            <TrendingUp className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-sm font-medium text-gray-900">{t('noOpportunitiesDetected')}</h3>
            <p className="mt-2 text-xs text-gray-600">
              {t('arbitrageDescription')}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('minimumThreshold', { percent: minProfitability })}
            </p>
          </div>
        )}

        {!isLoading && !error && opportunities && opportunities.length > 0 && (
          <div className="space-y-3">
            {opportunities.map((opportunity) => (
              <div
                key={opportunity.id}
                className="group rounded-lg border border-amber-200 bg-white p-4 shadow-sm transition-all hover:border-amber-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-gray-900">
                        {t('player')}: {opportunity.player.slice(0, 6)}...{opportunity.player.slice(-4)}
                      </h4>
                      <Badge
                        variant="secondary"
                        className="text-xs"
                      >
                        MID: {String(opportunity.marketId).slice(0, 8)}...
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('raffle:season')} {opportunity.seasonId}
                    </p>
                  </div>
                  <Badge className={getProfitabilityColor(Number(opportunity.profitability))}>
                    {Number(opportunity.profitability).toFixed(2)}% profit
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-gray-50 p-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('raffleCost')}</p>
                    <p className="text-sm font-medium">{Number(opportunity.rafflePrice).toFixed(4)} SOF</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('marketPrice')}</p>
                    <p className="text-sm font-medium">{Number(opportunity.marketPrice).toFixed(4)} SOF</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('spread')}</p>
                    <p className="text-sm font-medium text-green-600">
                      {Number(opportunity.priceDifference).toFixed(4)} SOF
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    <div className="flex-1">
                      <p className="text-xs font-medium text-amber-900">{t('strategy')}</p>
                      <p className="mt-1 text-xs text-amber-800">
                        {opportunity.direction === 'buy_raffle'
                          ? t('buyRaffleTickets', { 
                              price: Number(opportunity.rafflePrice).toFixed(4), 
                              sellPrice: Number(opportunity.marketPrice).toFixed(4) 
                            })
                          : t('buyInfoFiPosition', { 
                              price: Number(opportunity.marketPrice).toFixed(4), 
                              exitPrice: Number(opportunity.rafflePrice).toFixed(4) 
                            })
                        }
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex gap-3">
                    <span>
                      {t('raffle')}: {(Number(opportunity.raffleProbabilityBps) / 100).toFixed(2)}%
                    </span>
                    <span>
                      {t('market')}: {(Number(opportunity.marketSentimentBps) / 100).toFixed(2)}%
                    </span>
                  </div>
                  <span className="text-xs italic">
                    {t('estimatedProfitShort')}: {Number(opportunity.estimatedProfit).toFixed(4)} SOF
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {opportunities.length > 0 && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs text-blue-900">
              <strong>{t('note')}:</strong> {t('arbitrageNote')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

ArbitrageOpportunityDisplay.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  bondingCurveAddress: PropTypes.string.isRequired,
  minProfitability: PropTypes.number,
};

export default ArbitrageOpportunityDisplay;
