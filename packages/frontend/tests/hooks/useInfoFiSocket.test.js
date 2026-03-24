// tests/hooks/useInfoFiSocket.test.js
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const listeners = []
vi.mock('@/lib/wsClient', () => ({
  subscribe: (cb) => {
    listeners.push(cb)
    // return unsubscribe
    return () => {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  },
}))

// utility to emit a WS message to all subscribers
function emit(message) {
  listeners.forEach((cb) => cb(message))
}

describe('useInfoFiSocket', async () => {
  it('tracks WS status and caches market/raffle updates', async () => {
    const { useInfoFiSocket } = await import('@/hooks/useInfoFiSocket')

    const { result } = renderHook(() => useInfoFiSocket())

    // initial status
    expect(result.current.status).toBe('init')

    // emit status open
    act(() => {
      emit({ type: 'WS_STATUS', status: 'open' })
    })
    expect(result.current.status).toBe('open')

    // emit market update
    const mPayload = { market_id: 42, hybrid_price_bps: 1111 }
    act(() => {
      emit({ type: 'MARKET_UPDATE', payload: mPayload })
    })
    expect(result.current.getMarketUpdate(42)).toEqual(mPayload)

    // emit raffle update
    const rPayload = { seasonId: 7, player: '0xABCdef0001' }
    act(() => {
      emit({ type: 'RAFFLE_UPDATE', payload: rPayload })
    })
    expect(result.current.getRaffleUpdate(7, '0xabcdef0001')).toEqual(rPayload)
  })
})
