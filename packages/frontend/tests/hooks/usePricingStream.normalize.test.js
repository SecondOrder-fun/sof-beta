// tests/hooks/usePricingStream.normalize.test.js
import { describe, it, expect } from 'vitest'
import { normalizePricingMessage } from '@/hooks/usePricingStream'

describe('normalizePricingMessage', () => {
  it('returns bps fields when already in bps form', () => {
    const msg = {
      hybridPriceBps: 1234,
      raffleProbabilityBps: 5678,
      marketSentimentBps: 9012,
    }
    const out = normalizePricingMessage(msg)
    expect(out.hybridPriceBps).toBe(1234)
    expect(out.raffleProbabilityBps).toBe(5678)
    expect(out.marketSentimentBps).toBe(9012)
  })

  it('maps non-bps fields to bps keys', () => {
    const msg = {
      hybridPrice: 2222,
      raffleProbability: 3333,
      marketSentiment: 4444,
    }
    const out = normalizePricingMessage(msg)
    expect(out.hybridPriceBps).toBe(2222)
    expect(out.raffleProbabilityBps).toBe(3333)
    expect(out.marketSentimentBps).toBe(4444)
  })

  it('prefers explicit bps when both forms present', () => {
    const msg = {
      hybridPriceBps: 10,
      hybridPrice: 99,
      raffleProbabilityBps: 20,
      raffleProbability: 88,
      marketSentimentBps: 30,
      marketSentiment: 77,
    }
    const out = normalizePricingMessage(msg)
    expect(out.hybridPriceBps).toBe(10)
    expect(out.raffleProbabilityBps).toBe(20)
    expect(out.marketSentimentBps).toBe(30)
  })

  it('returns undefineds for invalid input', () => {
    const out = normalizePricingMessage(null)
    expect(out.hybridPriceBps).toBeUndefined()
    expect(out.raffleProbabilityBps).toBeUndefined()
    expect(out.marketSentimentBps).toBeUndefined()
  })

  it('supports nested pricing object with snake_case keys and last_updated', () => {
    const msg = {
      type: 'update',
      pricing: {
        hybrid_price_bps: 1111,
        raffle_probability_bps: 2222,
        market_sentiment_bps: 3333,
        last_updated: '2025-08-20T10:00:00Z'
      }
    }
    const out = normalizePricingMessage(msg)
    expect(out.hybridPriceBps).toBe(1111)
    expect(out.raffleProbabilityBps).toBe(2222)
    expect(out.marketSentimentBps).toBe(3333)
    expect(out.lastUpdated).toBe('2025-08-20T10:00:00Z')
  })

  it('falls back to msg.timestamp when lastUpdated not present', () => {
    const msg = {
      type: 'initial',
      timestamp: '2025-08-20T11:00:00Z',
      pricing: {
        hybridPriceBps: 4000,
        raffleProbabilityBps: 5000,
        marketSentimentBps: 6000
      }
    }
    const out = normalizePricingMessage(msg)
    expect(out.hybridPriceBps).toBe(4000)
    expect(out.raffleProbabilityBps).toBe(5000)
    expect(out.marketSentimentBps).toBe(6000)
    expect(out.lastUpdated).toBe('2025-08-20T11:00:00Z')
  })
})
