---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 9

## Arbitrage Detection System

### Arbitrage Detection Service
```javascript
// backend/src/services/arbitrageDetectionService.js
import { supabase } from '../config/supabase.js';
import { realTimePricingService } from './realTimePricingService.js';
import { EventEmitter } from 'events';

export class ArbitrageDetectionService extends EventEmitter {
  constructor() {
    super();
    this.detectionThreshold = 0.02; // 2% minimum profit threshold
    this.activeOpportunities = new Map();
    
    // Listen to pricing updates
    realTimePricingService.on('priceUpdate', this.onPriceUpdate.bind(this));
  }

  /**
   * Detect arbitrage opportunities when prices update
   */
  async onPriceUpdate(updateData) {
    const { marketId, raffleProbability, marketSentiment, hybridPrice } = updateData;
    
    // Get raffle contract data for comparison
    const rafflePrice = await this._getRafflePriceForMarket(marketId);
    if (!rafflePrice) return;

    // Calculate arbitrage opportunity
    const opportunity = this._calculateArbitrage(
      marketId,
      rafflePrice,
      hybridPrice,
      raffleProbability,
      marketSentiment
    );

    if (opportunity && opportunity.profitability >= this.detectionThreshold) {
      await this._recordOpportunity(opportunity);
      this.emit('arbitrageOpportunity', opportunity);
    }
  }

  /**
   * Calculate arbitrage opportunity between raffle and market pricing
   */
  _calculateArbitrage(marketId, rafflePrice, marketPrice, raffleProbability, marketSentiment) {
    const priceDifference = Math.abs(rafflePrice - marketPrice);
    const avgPrice = (rafflePrice + marketPrice) / 2;
    const profitability = (priceDifference / avgPrice) * 100;

    if (profitability < this.detectionThreshold) {
      return null;
    }

    // Determine optimal strategy
    let strategy = '';
    let estimatedProfit = 0;

    if (rafflePrice < marketPrice) {
      // Buy raffle position, sell in market
      strategy = `Buy raffle tickets at ${rafflePrice.toFixed(4)}, sell InfoFi position at ${marketPrice.toFixed(4)}`;
      estimatedProfit = marketPrice - rafflePrice;
    } else {
      // Buy market position, hedge with raffle
      strategy = `Buy InfoFi position at ${marketPrice.toFixed(4)}, hedge with raffle exit at ${rafflePrice.toFixed(4)}`;
      estimatedProfit = rafflePrice - marketPrice;
    }

    return {
      id: `${marketId}_${Date.now()}`,
      marketId,
      rafflePrice,
      marketPrice,
      priceDifference,
      profitability,
      estimatedProfit,
      strategy,
      raffleProbability,
      marketSentiment,
      detectedAt: new Date().toISOString()
    };
  }

  /**
   * Record arbitrage opportunity in database
   */
  async _recordOpportunity(opportunity) {
    try {
      // Get market details
      const { data: market } = await supabase
        .from('infofi_markets')
        .select('raffle_id, player_id, players(address)')
        .eq('id', opportunity.marketId)
        .single();

      if (!market) return;

      const { error } = await supabase
        .from('arbitrage_opportunities')
        .insert({
          raffle_id: market.raffle_id,
          player_address: market.players.address,
          market_id: opportunity.marketId,
          raffle_price: opportunity.rafflePrice,
          market_price: opportunity.marketPrice,
          price_difference: opportunity.priceDifference,
          profitability: opportunity.profitability,
          estimated_profit: opportunity.estimatedProfit,
          created_at: opportunity.detectedAt
        });

      if (error) {
        console.error('Failed to record arbitrage opportunity:', error);
      }

      // Cache active opportunity
      this.activeOpportunities.set(opportunity.id, opportunity);

      // Clean up old opportunities (remove after 5 minutes)
      setTimeout(() => {
        this.activeOpportunities.delete(opportunity.id);
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Error recording arbitrage opportunity:', error);
    }
  }

  /**
   * Get raffle price for market comparison
   */
  async _getRafflePriceForMarket(marketId) {
    try {
      // This would calculate the effective price of entering the raffle
      // for the same position that's being traded in the InfoFi market
      
      // Get market details
      const { data: market } = await supabase
        .from('infofi_markets')
        .select('raffle_id, player_id, current_probability')
        .eq('id', marketId)
        .single();

      if (!market) return null;

      // Calculate current raffle entry cost for equivalent position
      // This is a simplified calculation - in practice would use bonding curve math
      const baseCost = 10; // Base cost per ticket in SOF
      const probabilityMultiplier = market.current_probability / 100; // Convert basis points to decimal
      
      return baseCost * (1 + probabilityMultiplier);
    } catch (error) {
      console.error('Failed to get raffle price:', error);
      return null;
    }
  }

  /**
   * Get all active arbitrage opportunities
   */
  getActiveOpportunities(raffleId = null) {
    const opportunities = Array.from(this.activeOpportunities.values());
    
    if (raffleId) {
      // Filter by raffle ID if specified
      return opportunities.filter(opp => 
        opp.raffleId === raffleId
      );
    }
    
    return opportunities;
  }

  /**
   * Execute arbitrage opportunity (placeholder for actual implementation)
   */
  async executeArbitrage(opportunityId, userAddress, amount) {
    const opportunity = this.activeOpportunities.get(opportunityId);
    if (!opportunity) {
      throw new Error('Opportunity not found or expired');
    }

    // This would implement the actual arbitrage execution
    // 1. Check if opportunity still valid
    // 2. Execute trades in correct order
    // 3. Handle slippage and timing
    // 4. Record execution results

    // Mark as executed
    await supabase
      .from('arbitrage_opportunities')
      .update({
        is_executed: true,
        executed_at: new Date().toISOString()
      })
      .eq('market_id', opportunity.marketId)
      .eq('created_at', opportunity.detectedAt);

    // Remove from active opportunities
    this.activeOpportunities.delete(opportunityId);

    return {
      success: true,
      executedAt: new Date().toISOString(),
      opportunity
    };
  }

  /**
   * Set detection threshold (admin function)
   */
  setDetectionThreshold(threshold) {
    this.detectionThreshold = threshold;
  }
}

export const arbitrageDetectionService = new ArbitrageDetectionService();
```

## Security Considerations

### Smart Contract Security
- **VRF Integration**: Use OpenZeppelin's VRFConsumerBaseV2Plus for secure randomness
- **Access Control**: Implement OpenZeppelin AccessControl with role-based permissions
- **Reentrancy Protection**: Use ReentrancyGuard for all external calls
- **Integer Overflow**: Solidity ^0.8.20 has built-in overflow protection
- **Emergency Pauses**: Implement circuit breakers for InfoFi market creation

### Real-Time Data Security
- **Price Manipulation**: Multiple data sources and circuit breakers
- **SSE Security**: Rate limiting and connection management
- **Database Security**: Row-level s