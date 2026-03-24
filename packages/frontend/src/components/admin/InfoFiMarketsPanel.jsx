// src/components/admin/InfoFiMarketsPanel.jsx
import { useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Activity, TrendingUp, TrendingDown } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useInfoFiMarketsAdmin } from '@/hooks/useInfoFiMarketsAdmin';
import { cn } from '@/lib/utils';

/**
 * Format address to short form (0x1234...5678)
 * 
 * @param {string} address - Full Ethereum address
 * @returns {string} Shortened address
 */
const formatAddress = (address) => {
  if (!address || address.length < 10) return address || 'N/A';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * Format market type to human-readable name
 * 
 * @param {string} marketType - Market type enum
 * @returns {string} Formatted market type
 */
const formatMarketType = (marketType) => {
  if (!marketType) return 'Unknown';
  return marketType
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Format volume with SOF suffix and optional change indicator
 * 
 * @param {string|number} volume - Volume amount
 * @param {string|number} change24h - 24h change amount
 * @returns {string} Formatted volume string
 */
const formatVolume = (volume, change24h) => {
  const vol = parseFloat(volume) || 0;
  const change = parseFloat(change24h) || 0;
  
  const volStr = vol.toFixed(2);
  
  if (change === 0) {
    return `${volStr} SOF`;
  }
  
  const changeStr = change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
  return `${volStr} SOF (${changeStr} SOF)`;
};

/**
 * Individual market row component
 * 
 * @param {Object} props - Component props
 * @param {Object} props.market - Market data
 * @returns {JSX.Element}
 */
const MarketRow = ({ market }) => {
  const { t } = useTranslation('admin');
  const change24h = parseFloat(market.priceChange24h) || 0;
  
  return (
    <div className="grid grid-cols-5 gap-4 py-3 px-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors">
      <div className="col-span-1">
        <p className="text-sm font-medium">
          {formatMarketType(market.marketType)} - {formatAddress(market.playerAddress)}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('infoFiMarkets.id')}: {market.id}
        </p>
      </div>
      
      <div className="col-span-1 flex items-center">
        <p className="text-sm">{market.seasonId || 'N/A'}</p>
      </div>
      
      <div className="col-span-1 flex items-center gap-2">
        <p className="text-sm">
          {formatVolume(market.volume24h, market.priceChange24h)}
        </p>
        {change24h > 0 && <TrendingUp className="h-4 w-4 text-success" />}
        {change24h < 0 && <TrendingDown className="h-4 w-4 text-destructive" />}
      </div>
      
      <div className="col-span-1 flex items-center">
        <p className="text-sm">{parseFloat(market.totalVolume || 0).toFixed(2)} SOF</p>
      </div>
      
      <div className="col-span-1 flex items-center gap-2">
        <Activity className={cn(
          "h-4 w-4",
          market.isActive ? "text-success" : "text-muted-foreground"
        )} />
        <span className="text-xs">
          {market.isActive ? t('infoFiMarkets.active') : t('infoFiMarkets.settled')}
        </span>
      </div>
    </div>
  );
};

MarketRow.propTypes = {
  market: PropTypes.shape({
    id: PropTypes.number.isRequired,
    seasonId: PropTypes.number,
    marketType: PropTypes.string.isRequired,
    playerAddress: PropTypes.string,
    volume24h: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    priceChange24h: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    totalVolume: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    isActive: PropTypes.bool,
  }).isRequired,
};

/**
 * Season group component with collapsible markets list
 * 
 * @param {Object} props - Component props
 * @param {Object} props.season - Season data with markets
 * @returns {JSX.Element}
 */
const SeasonGroup = ({ season }) => {
  const { t } = useTranslation('admin');
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg mb-4">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          )}
          <div className="text-left">
            <h3 className="text-lg font-semibold">
              {t('infoFiMarkets.seasonNumber', { number: season.seasonId })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('infoFiMarkets.marketCount', { 
                count: season.totalMarkets,
                active: season.activeMarkets 
              })}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">
            {t('infoFiMarkets.totalVolume')}: {season.totalVolume.toFixed(2)} SOF
          </p>
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="border-t">
          {/* Header row */}
          <div className="grid grid-cols-5 gap-4 py-2 px-4 bg-muted/30 text-xs font-semibold text-muted-foreground">
            <div>{t('infoFiMarkets.marketName')}</div>
            <div>{t('infoFiMarkets.season')}</div>
            <div>{t('infoFiMarkets.currentLiquidity')}</div>
            <div>{t('infoFiMarkets.totalVolume')}</div>
            <div>{t('infoFiMarkets.status')}</div>
          </div>
          
          {/* Market rows */}
          {season.markets.map((market) => (
            <MarketRow key={market.id} market={market} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

SeasonGroup.propTypes = {
  season: PropTypes.shape({
    seasonId: PropTypes.number.isRequired,
    totalMarkets: PropTypes.number.isRequired,
    activeMarkets: PropTypes.number.isRequired,
    totalVolume: PropTypes.number.isRequired,
    markets: PropTypes.arrayOf(PropTypes.object).isRequired,
  }).isRequired,
};

/**
 * Main InfoFi Markets Admin Panel Component
 * Displays all InfoFi markets grouped by season with liquidity metrics
 * 
 * @returns {JSX.Element}
 */
const InfoFiMarketsPanel = () => {
  const { t } = useTranslation('admin');
  const { data, isLoading, error } = useInfoFiMarketsAdmin();
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('infoFiMarkets.title')}</CardTitle>
          <CardDescription>{t('infoFiMarkets.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">{t('infoFiMarkets.loading')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('infoFiMarkets.title')}</CardTitle>
          <CardDescription>{t('infoFiMarkets.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <p className="text-destructive">
              {t('infoFiMarkets.error')}: {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  const seasons = data?.seasons || [];
  
  if (seasons.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('infoFiMarkets.title')}</CardTitle>
          <CardDescription>{t('infoFiMarkets.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">{t('infoFiMarkets.noMarkets')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('infoFiMarkets.title')}</CardTitle>
        <CardDescription>
          {t('infoFiMarkets.description')} - {t('infoFiMarkets.summary', {
            total: data.totalMarkets,
            active: data.totalActiveMarkets
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {seasons.map((season) => (
            <SeasonGroup key={season.seasonId} season={season} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default InfoFiMarketsPanel;
