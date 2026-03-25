---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 6

## Backend Architecture Updates

### Enhanced Backend Services

#### infoFiMarketService.js
```javascript
// backend/src/services/infoFiMarketService.js
import { supabase } from '../config/supabase.js';
import { contractService } from './contractService.js';
import { realTimePricingService } from './realTimePricingService.js';

export class InfoFiMarketService {
  
  /**
   * Create a new InfoFi market when position threshold is crossed
   */
  async createMarket(raffleId, playerId, marketType, initialProbability) {
    try {
      // Create market record in database
      const { data: market, error } = await supabase
        .from('infofi_markets')
        .insert({
          raffle_id: raffleId,
          player_id: playerId,
          market_type: marketType,
          initial_probability: initialProbability,
          current_probability: initialProbability,
          is_active: true,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Deploy smart contract for this market
      const contractAddress = await contractService.deployInfoFiMarket({
        marketId: market.id,
        playerId,
        marketType,
        initialProbability
      });

      // Update market with contract address
      await supabase
        .from('infofi_markets')
        .update({ contract_address: contractAddress })
        .eq('id', market.id);

      // Initialize real-time pricing
      await realTimePricingService.initializeMarket(market.id, initialProbability);

      return { ...market, contract_address: contractAddress };
    } catch (error) {
      console.error('Failed to create InfoFi market:', error);
      throw error;
    }
  }

  /**
   * Update market pricing based on raffle position changes
   */
  async updateMarketPricing(playerId, newProbability) {
    try {
      // Get all active markets for this player
      const { data: markets, error } = await supabase
        .from('infofi_markets')
        .select('*')
        .eq('player_id', playerId)
        .eq('is_active', true);

      if (error) throw error;

      // Update each market's raffle probability component
      for (const market of markets) {
        await realTimePricingService.updateRaffleProbability(
          market.id,
          newProbability
        );
        
        // Update database record
        await supabase
          .from('infofi_markets')
          .update({ 
            current_probability: newProbability,
            updated_at: new Date().toISOString()
          })
          .eq('id', market.id);
      }

      return markets;
    } catch (error) {
      console.error('Failed to update market pricing:', error);
      throw error;
    }
  }

  /**
   * Get all active markets for a raffle
   */
  async getMarketsForRaffle(raffleId) {
    try {
      const { data: markets, error } = await supabase
        .from('infofi_markets')
        .select(`
          *,
          players:player_id (
            address,
            current_position,
            win_probability
          )
        `)
        .eq('raffle_id', raffleId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Enrich with real-time pricing data
      const enrichedMarkets = await Promise.all(
        markets.map(async (market) => {
          const pricing = await realTimePricingService.getCurrentPrice(market.id);
          return {
            ...market,
            current_price: pricing.hybridPrice,
            raffle_component: pricing.raffleProbability,
            market_component: pricing.marketSentiment,
            last_updated: pricing.lastUpdate
          };
        })
      );

      return enrichedMarkets;
    } catch (error) {
      console.error('Failed to get markets for raffle:', error);
      throw error;
    }
  }

  /**
   * Handle market settlement when raffle ends
   */
  async settleMarkets(raffleId, winnerId, vrfResult) {
    try {
      // Get all active markets for this raffle
      const { data: markets, error } = await supabase
        .from('infofi_markets')
        .select('*')
        .eq('raffle_id', raffleId)
        .eq('is_active', true);

      if (error) throw error;

      const settlementResults = [];

      // Settle each market based on outcome
      for (const market of markets) {
        let isWinningOutcome = false;
        
        // Determine if this market's predictions were correct
        switch (market.market_type) {
          case 'WINNER_PREDICTION':
            isWinningOutcome = market.player_id === winnerId;
            break;
          case 'POSITION_SIZE':
            // Check if final position matched predictions
            isWinningOutcome = await this._checkPositionSizePrediction(market, winnerId);
            break;
          case 'BEHAVIORAL':
            // Check if behavioral predictions were correct
            isWinningOutcome = await this._checkBehavioralPrediction(market, winnerId);
            break;
        }

        // Calculate winnings and settle market
        const settlement = await this._settleMarket(market.id, isWinningOutcome, vrfResult);
        settlementResults.push(settlement);

        // Update market status
        await supabase
          .from('infofi_markets')
          .update({
            is_active: false,
            is_settled: true,
            settlement_time: new Date().toISOString(),
            winning_outcome: isWinningOutcome
          })
          .eq('id', market.id);
      }

      return settlementResults;
    } catch (error) {
      console.error('Failed to settle markets:', error);
      throw error;
    }
  }

  /**
   * Private method to settle individual market
   */
  async _settleMarket(marketId, isWinningOutcome, vrfResult) {
    // Implementation depends on chosen InfoFi framework
    // This would calculate winnings for all positions and distribute them
    
    // Get all positions in this market
    const { data: positions, error } = await supabase
      .from('infofi_positions')
      .select('*')
      .eq('market_id', marketId);

    if (error) throw error;

    const settlements = [];

    for (const position of positions) {
      // Calculate if this position wins based on outcome
      const positionWins = this._calculatePositionOutcome(position, isWinningOutcome);
      
      if (positionWins) {
        const winnings = await this._calculateWinnings(position, marketId);
        
        // Record winnings for user to claim
        await supabase
          .from('infofi_winnings')
          .insert({
            user_id: position.user_id,
            market_id: marketId,
            amount: winnings,
            is_claimed: false,
            created_at: new Date().toISOString()
          });

        settlements.push({
          userId: position.user_id,
          amount: winnings
        });
      }
    }

    return settlements;
  }

  /**
   * Get user's positions across all markets for a raffle
   */
  async getUserPositions(raffleId, userAddress) {
    try {
      const { data: positions, error } = await supabase
        .from('infofi_positions')
        .select(`
          *,
          infofi_markets:market_id (
            id,
            market_type,
            player_id,
            current_probability,
            is_active
          )
        `)
        .eq('user_address', userAddress)
        .eq('infofi_markets.raffle_id', raffleId);

      if (error) throw error;

      return positions;
    } catch (error) {
      console.error('Failed to get user positions:', error);
      throw error;
    }
  }

  /**
   * Place a bet in an InfoFi market
   */
  async placeBet(marketId, outcome, amount, userAddress) {
    try {
      // Record the position
      const { data: position, error } = await supabase
        .from('infofi_positions')
        .insert({
          market_id: marketId,
          user_address: userAddress,
          outcome: outcome, // 'YES' or 'NO'
          amount: amount,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Update market sentiment based on new bet
      await realTimePricingService.updateMarketSentiment(marketId, outcome, amount);

      return position;
    } catch (error) {
      console.error('Failed to place bet:', error);
      throw error;
    }
  }
}

export const infoFiMarketService = new InfoFiMarketService();
```