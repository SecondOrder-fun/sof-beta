---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 8

## Real-Time Architecture Implementation

### Server-Sent Events (SSE) Integration

#### Real-Time Pricing Service
```javascript
// backend/src/services/realTimePricingService.js
import { supabase } from '../config/supabase.js';
import { EventEmitter } from 'events';

export class RealTimePricingService extends EventEmitter {
  constructor() {
    super();
    this.pricingCache = new Map(); // In-memory cache for ultra-fast access
    this.subscribers = new Map(); // SSE connections per market
  }

  /**
   * Initialize market pricing when market is created
   */
  async initializeMarket(marketId, initialProbability) {
    const pricingData = {
      marketId,
      raffleProbability: initialProbability,
      marketSentiment: initialProbability, // Start with same value
      hybridPrice: initialProbability,
      raffleWeight: 7000, // 70%
      marketWeight: 3000, // 30%
      lastUpdated: new Date().toISOString()
    };

    // Store in cache
    this.pricingCache.set(marketId, pricingData);

    // Store in database
    await supabase
      .from('market_pricing_cache')
      .upsert({
        market_id: marketId,
        raffle_probability: initialProbability,
        market_sentiment: initialProbability,
        hybrid_price: initialProbability,
        last_updated: new Date().toISOString()
      });

    return pricingData;
  }

  /**
   * Update raffle probability component (from position changes)
   */
  async updateRaffleProbability(marketId, newProbability) {
    const cached = this.pricingCache.get(marketId);
    if (!cached) {
      console.warn(`No cached pricing data for market ${marketId}`);
      return;
    }

    const oldHybridPrice = cached.hybridPrice;
    
    // Calculate new hybrid price
    const newHybridPrice = this._calculateHybridPrice(
      newProbability,
      cached.marketSentiment,
      cached.raffleWeight,
      cached.marketWeight
    );

    // Update cache
    cached.raffleProbability = newProbability;
    cached.hybridPrice = newHybridPrice;
    cached.lastUpdated = new Date().toISOString();

    // Update database
    await supabase
      .from('market_pricing_cache')
      .update({
        raffle_probability: newProbability,
        hybrid_price: newHybridPrice,
        last_updated: cached.lastUpdated
      })
      .eq('market_id', marketId);

    // Emit real-time update
    this._broadcastPriceUpdate(marketId, {
      type: 'raffle_probability_update',
      marketId,
      oldPrice: oldHybridPrice,
      newPrice: newHybridPrice,
      raffleProbability: newProbability,
      marketSentiment: cached.marketSentiment,
      timestamp: cached.lastUpdated
    });

    return cached;
  }

  /**
   * Update market sentiment component (from trading activity)
   */
  async updateMarketSentiment(marketId, outcome, betAmount) {
    const cached = this.pricingCache.get(marketId);
    if (!cached) return;

    // Simple sentiment calculation based on bet flow
    // In practice, this would be more sophisticated
    const sentimentAdjustment = outcome === 'YES' ? betAmount * 100 : -betAmount * 100;
    const newSentiment = Math.max(0, Math.min(10000, 
      cached.marketSentiment + sentimentAdjustment
    ));

    const oldHybridPrice = cached.hybridPrice;
    const newHybridPrice = this._calculateHybridPrice(
      cached.raffleProbability,
      newSentiment,
      cached.raffleWeight,
      cached.marketWeight
    );

    // Update cache
    cached.marketSentiment = newSentiment;
    cached.hybridPrice = newHybridPrice;
    cached.lastUpdated = new Date().toISOString();

    // Update database  
    await supabase
      .from('market_pricing_cache')
      .update({
        market_sentiment: newSentiment,
        hybrid_price: newHybridPrice,
        last_updated: cached.lastUpdated
      })
      .eq('market_id', marketId);

    // Broadcast update
    this._broadcastPriceUpdate(marketId, {
      type: 'market_sentiment_update',
      marketId,
      oldPrice: oldHybridPrice,
      newPrice: newHybridPrice,
      raffleProbability: cached.raffleProbability,
      marketSentiment: newSentiment,
      betOutcome: outcome,
      betAmount,
      timestamp: cached.lastUpdated
    });

    return cached;
  }

  /**
   * Calculate hybrid price using weighted formula
   */
  _calculateHybridPrice(raffleProbability, marketSentiment, raffleWeight, marketWeight) {
    return Math.round(
      (raffleWeight * raffleProbability + marketWeight * marketSentiment) / 10000
    );
  }

  /**
   * Broadcast price updates to SSE subscribers
   */
  _broadcastPriceUpdate(marketId, updateData) {
    // Emit to EventEmitter listeners
    this.emit('priceUpdate', updateData);

    // Send to SSE subscribers
    const subscribers = this.subscribers.get(marketId);
    if (subscribers) {
      subscribers.forEach(response => {
        try {
          response.write(`data: ${JSON.stringify(updateData)}\n\n`);
        } catch (error) {
          console.error('Failed to send SSE update:', error);
          // Remove failed connection
          subscribers.delete(response);
        }
      });
    }

    // Also broadcast to 'all markets' subscribers
    const allSubscribers = this.subscribers.get('ALL');
    if (allSubscribers) {
      allSubscribers.forEach(response => {
        try {
          response.write(`data: ${JSON.stringify(updateData)}\n\n`);
        } catch (error) {
          console.error('Failed to send SSE update to all subscribers:', error);
          allSubscribers.delete(response);
        }
      });
    }
  }

  /**
   * Add SSE subscriber for market updates
   */
  addSubscriber(marketId, response) {
    if (!this.subscribers.has(marketId)) {
      this.subscribers.set(marketId, new Set());
    }
    this.subscribers.get(marketId).add(response);

    // Send current price immediately
    const cached = this.pricingCache.get(marketId);
    if (cached) {
      response.write(`data: ${JSON.stringify({
        type: 'initial_price',
        marketId,
        raffleProbability: cached.raffleProbability,
        marketSentiment: cached.marketSentiment,
        hybridPrice: cached.hybridPrice,
        timestamp: cached.lastUpdated
      })}\n\n`);
    }

    // Clean up on connection close
    response.on('close', () => {
      const subscribers = this.subscribers.get(marketId);
      if (subscribers) {
        subscribers.delete(response);
        if (subscribers.size === 0) {
          this.subscribers.delete(marketId);
        }
      }
    });
  }

  /**
   * Get current price from cache
   */
  getCurrentPrice(marketId) {
    return this.pricingCache.get(marketId) || null;
  }

  /**
   * Get all cached prices (for dashboard/admin views)
   */
  getAllPrices() {
    return Array.from(this.pricingCache.values());
  }
}

export const realTimePricingService = new RealTimePricingService();
```

#### SSE Route Implementation
```javascript
// backend/src/routes/stream/infoFiPricing.js
import { realTimePricingService } from '../../services/realTimePricingService.js';

export default async function infoFiPricingRoutes(fastify) {
  
  /**
   * SSE endpoint for real-time market pricing updates
   */
  fastify.get('/pricing/:marketId', async (request, reply) => {
    const { marketId } = request.params;
    
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Add subscriber
    realTimePricingService.addSubscriber(marketId, reply.raw);

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch (error) {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      reply.raw.end();
    });
  });

  /**
   * SSE endpoint for all market updates
   */
  fastify.get('/pricing/all', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    realTimePricingService.addSubscriber('ALL', reply.raw);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch (error) {
        clearInterval(heartbeat);
      }
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      reply.raw.end();
    });
  });

  /**
   * REST endpoint to get current pricing snapshot
   */
  fastify.get('/pricing/:marketId/current', async (request, reply) => {
    const { marketId } = request.params;
    const pricing = realTimePricingService.getCurrentPrice(marketId);
    
    if (!pricing) {
      return reply.code(404).send({ error: 'Market pricing not found' });
    }

    return pricing;
  });
}
```