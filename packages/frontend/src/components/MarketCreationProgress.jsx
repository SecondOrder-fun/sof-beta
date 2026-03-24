/**
 * @file MarketCreationProgress.jsx
 * @description Component for displaying real-time market creation progress
 * Shows status of market creation via Paymaster with SSE updates
 * @author SecondOrder.fun
 */

import { useState } from 'react';
import PropTypes from 'prop-types';
import { useMarketEvents } from '../hooks/useMarketEvents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react';

/**
 * MarketCreationProgress Component
 * Displays real-time market creation status for a specific player
 *
 * @param {Object} props - Component props
 * @param {string} props.playerAddress - Player address to track
 * @param {number} props.seasonId - Season ID to track
 * @param {boolean} props.enabled - Whether to enable SSE connection
 * @returns {JSX.Element} Market creation progress component
 */
export function MarketCreationProgress({
  playerAddress,
  seasonId,
  enabled = true,
}) {
  const [marketStatus, setMarketStatus] = useState('idle'); // idle, started, confirmed, failed
  const [marketData, setMarketData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const { isConnected, connectionError, getPlayerEvents } = useMarketEvents({
    enabled,
    onMarketCreationStarted: (data) => {
      if (
        data.player.toLowerCase() === playerAddress.toLowerCase() &&
        data.seasonId === seasonId
      ) {
        setMarketStatus('started');
        setMarketData(data);
        setErrorMessage(null);
      }
    },
    onMarketCreationConfirmed: (data) => {
      if (
        data.player.toLowerCase() === playerAddress.toLowerCase() &&
        data.seasonId === seasonId
      ) {
        setMarketStatus('confirmed');
        setMarketData(data);
        setErrorMessage(null);
      }
    },
    onMarketCreationFailed: (data) => {
      if (
        data.player.toLowerCase() === playerAddress.toLowerCase() &&
        data.seasonId === seasonId
      ) {
        setMarketStatus('failed');
        setMarketData(data);
        setErrorMessage(data.error);
      }
    },
  });

  // Get recent events for this player
  const playerEvents = getPlayerEvents(playerAddress);

  // Determine status display
  const getStatusDisplay = () => {
    switch (marketStatus) {
      case 'started':
        return {
          icon: <Clock className="h-5 w-5 text-blue-500" />,
          label: 'Creating Market',
          color: 'bg-blue-50 border-blue-200',
          badge: 'in-progress',
        };
      case 'confirmed':
        return {
          icon: <CheckCircle className="h-5 w-5 text-green-500" />,
          label: 'Market Created',
          color: 'bg-green-50 border-green-200',
          badge: 'success',
        };
      case 'failed':
        return {
          icon: <AlertCircle className="h-5 w-5 text-red-500" />,
          label: 'Creation Failed',
          color: 'bg-red-50 border-red-200',
          badge: 'error',
        };
      default:
        return {
          icon: <Zap className="h-5 w-5 text-gray-400" />,
          label: 'Waiting',
          color: 'bg-gray-50 border-gray-200',
          badge: 'idle',
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <Card className={`border ${statusDisplay.color}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {statusDisplay.icon}
            {statusDisplay.label}
          </CardTitle>
          <Badge variant={statusDisplay.badge === 'success' ? 'default' : 'secondary'}>
            {statusDisplay.badge}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center gap-2 text-sm">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-muted-foreground">
            {isConnected ? 'Connected to updates' : 'Disconnected'}
          </span>
        </div>

        {/* Connection Error */}
        {connectionError && (
          <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            Connection error: {connectionError}
          </div>
        )}

        {/* Market Data */}
        {marketData && (
          <div className="space-y-2 rounded-md bg-white p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Season:</span>
              <span className="font-medium">{marketData.seasonId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Player:</span>
              <span className="font-mono text-xs">
                {marketData.player.slice(0, 6)}...{marketData.player.slice(-4)}
              </span>
            </div>
            {marketData.probability && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Probability:</span>
                <span className="font-medium">{marketData.probability} bps</span>
              </div>
            )}
            {marketData.transactionHash && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">TX Hash:</span>
                <span className="font-mono text-xs">
                  {marketData.transactionHash.slice(0, 10)}...
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error Message */}
        {errorMessage && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Error:</p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        )}

        {/* Event History */}
        {playerEvents.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Recent Events:</p>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {playerEvents.slice(-5).map((event, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-sm bg-gray-50 p-2 text-xs"
                >
                  <span className="text-muted-foreground">{event.event}</span>
                  <span className="text-gray-400">
                    {new Date(event.receivedAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Message */}
        <div className="text-xs text-muted-foreground">
          {marketStatus === 'idle' &&
            'Waiting for market creation to be triggered...'}
          {marketStatus === 'started' &&
            'Market creation submitted via Paymaster. Waiting for confirmation...'}
          {marketStatus === 'confirmed' &&
            'Market successfully created! You can now trade on this market.'}
          {marketStatus === 'failed' &&
            'Market creation failed. Please try again or contact support.'}
        </div>
      </CardContent>
    </Card>
  );
}

MarketCreationProgress.propTypes = {
  playerAddress: PropTypes.string.isRequired,
  seasonId: PropTypes.number.isRequired,
  enabled: PropTypes.bool,
};

export default MarketCreationProgress;
