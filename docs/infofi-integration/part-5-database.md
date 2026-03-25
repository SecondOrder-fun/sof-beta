---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 5

## Frontend Architecture Updates

### Enhanced Project Structure

```
src/features/prediction/
├── components/
│   ├── InfoFiMarketCard.jsx              // Individual market display with real-time pricing
│   ├── ProbabilityChart.jsx              // Live probability visualization
│   ├── ArbitrageOpportunityDisplay.jsx   // Cross-layer arbitrage alerts
│   ├── CrossLayerStrategyPanel.jsx       // Multi-layer strategy tools
│   ├── MarketDepthVisualization.jsx      // Market liquidity and order book
│   ├── SettlementStatus.jsx              // Settlement progress tracking
│   └── WinningsClaimPanel.jsx            // Claim interface for settled markets
├── hooks/
│   ├── useInfoFiMarkets.js               // Market data with React Query
│   ├── useArbitrageOpportunities.js      // Real-time arbitrage detection
│   ├── useCrossLayerStrategy.js          // Multi-layer position management
│   ├── useMarketPricing.js               // Hybrid pricing calculations
│   ├── useSettlement.js                  // Settlement status tracking
│   └── useWinningsClaim.js               // Claim functionality
├── services/
│   ├── infoFiMarketService.js            // Market CRUD operations
│   ├── arbitrageService.js               // Arbitrage detection algorithms
│   ├── crossLayerService.js              // Cross-layer coordination
│   ├── settlementService.js              // Settlement tracking
│   └── pricingService.js                 // Hybrid pricing calculations
└── types/
    ├── infoFiMarket.js                   // InfoFi market type definitions
    ├── arbitrage.js                      // Arbitrage opportunity types
    └── settlement.js                     // Settlement-related types
```

### Key Frontend Components

#### useInfoFiMarkets.js Hook
```javascript
// src/hooks/useInfoFiMarkets.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { infoFiMarketService } from '@/services/infoFiMarketService';

export const useInfoFiMarkets = (raffleId) => {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  // Query for active markets
  const {
    data: markets,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['infoFiMarkets', raffleId],
    queryFn: () => infoFiMarketService.getMarketsForRaffle(raffleId),
    enabled: !!raffleId,
    staleTime: 30000, // 30 seconds
    refetchInterval: 10000, // Refetch every 10 seconds for real-time updates
  });

  // Query for user's positions in markets
  const {
    data: userPositions,
    isLoading: isLoadingPositions
  } = useQuery({
    queryKey: ['infoFiPositions', raffleId, address],
    queryFn: () => infoFiMarketService.getUserPositions(raffleId, address),
    enabled: !!(raffleId && address),
    staleTime: 15000,
  });

  // Mutation for placing bets
  const placeBetMutation = useMutation({
    mutationFn: ({ marketId, outcome, amount }) =>
      infoFiMarketService.placeBet(marketId, outcome, amount),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['infoFiMarkets', raffleId] });
      queryClient.invalidateQueries({ queryKey: ['infoFiPositions', raffleId, address] });
    },
  });

  return {
    markets,
    userPositions,
    isLoading: isLoading || isLoadingPositions,
    error,
    refetch,
    placeBet: placeBetMutation.mutate,
    isPlacingBet: placeBetMutation.isPending,
  };
};
```
#### ArbitrageOpportunityDisplay.jsx Component
```javascript
// src/components/prediction/ArbitrageOpportunityDisplay.jsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { useArbitrageOpportunities } from '@/hooks/useArbitrageOpportunities';

const ArbitrageOpportunityDisplay = ({ raffleId }) => {
  const { opportunities, isLoading, executeArbitrage } = useArbitrageOpportunities(raffleId);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);

  if (isLoading) {
    return <div className="animate-pulse">Loading arbitrage opportunities...</div>;
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-amber-600" />
          Arbitrage Opportunities
        </CardTitle>
      </CardHeader>
      <CardContent>
        {opportunities.length === 0 ? (
          <p className="text-muted-foreground">No arbitrage opportunities detected</p>
        ) : (
          <div className="space-y-3">
            {opportunities.map((opportunity) => (
              <div
                key={opportunity.id}
                className="p-3 border rounded-lg hover:bg-amber-100 cursor-pointer"
                onClick={() => setSelectedOpportunity(opportunity)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-medium">{opportunity.description}</h4>
                    <p className="text-sm text-muted-foreground">
                      Player: {opportunity.player.slice(0, 6)}...{opportunity.player.slice(-4)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={opportunity.profitability > 5 ? "default" : "secondary"}>
                      {opportunity.profitability.toFixed(2)}% profit
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      Est. {opportunity.estimatedProfit.toFixed(4)} ETH
                    </p>
                  </div>
                </div>
                
                <div className="mt-2 flex gap-2">
                  <Badge variant="outline" className="text-xs">
                    Raffle: {opportunity.rafflePrice.toFixed(4)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    Market: {opportunity.marketPrice.toFixed(4)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    Spread: {opportunity.priceDifference.toFixed(4)}
                  </Badge>
                </div>
                
                {selectedOpportunity?.id === opportunity.id && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium">Execution Strategy</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {opportunity.strategy}
                    </p>
                    <Button
                      onClick={() => executeArbitrage(opportunity.id)}
                      className="w-full"
                      variant="outline"
                    >
                      Execute Arbitrage
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ArbitrageOpportunityDisplay;
```
