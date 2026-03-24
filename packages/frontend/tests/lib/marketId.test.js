// tests/lib/marketId.test.js
import { describe, it, expect } from 'vitest'
import { formatMarketId, parseMarketId, isValidMarketId, MARKET_ID_TYPES } from '@/lib/marketId'

describe('marketId helpers', () => {
  it('formatMarketId builds canonical format', () => {
    const id = formatMarketId({ seasonId: 12, marketType: 'winner_prediction', subject: '0xAbCDEFabcdefabcdefabcdefabcdefabcdefabcd' })
    expect(id).toBe('12:WINNER_PREDICTION:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
  })

  it('parseMarketId splits into parts and lowercases subject', () => {
    const { seasonId, marketType, subject } = parseMarketId('7:POSITION_SIZE:0xABCDEFabcdefabcdefabcdefabcdefabcdefabcd')
    expect(seasonId).toBe('7')
    expect(marketType).toBe('POSITION_SIZE')
    expect(subject).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
  })

  it('allows subject "-" for global markets', () => {
    const id = formatMarketId({ seasonId: '3', marketType: 'TOTAL_TICKETS', subject: '-' })
    expect(id).toBe('3:TOTAL_TICKETS:-')
    expect(isValidMarketId(id)).toBe(true)
  })

  it('isValidMarketId enforces digits seasonId, allowed types, and address/"-"', () => {
    expect(isValidMarketId('1:WINNER_PREDICTION:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(true)
    expect(isValidMarketId('01:WINNER_PREDICTION:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(true)
    expect(isValidMarketId('x:WINNER_PREDICTION:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(false)
    expect(isValidMarketId('1:NOT_A_TYPE:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(false)
    expect(isValidMarketId('1:POSITION_SIZE:abcd')).toBe(false)
    expect(isValidMarketId('1:POSITION_SIZE:0xABC')).toBe(false)
  })

  it('MARKET_ID_TYPES exposes allowed types list', () => {
    expect(Array.isArray(MARKET_ID_TYPES)).toBe(true)
    expect(MARKET_ID_TYPES).toContain('WINNER_PREDICTION')
  })
})
