// tests/lib/contracts-config.test.js
import { describe, it, expect, vi } from 'vitest'
import { getContractAddresses, RAFFLE_ABI, sanitizeAddress } from '@/config/contracts'

describe('config/contracts', () => {
  it('returns an object with expected keys for LOCAL', () => {
    const addr = getContractAddresses('LOCAL')
    expect(addr).toHaveProperty('RAFFLE')
    expect(addr).toHaveProperty('SOF')
    expect(addr).toHaveProperty('SOF_SMART_ACCOUNT')
  })

  it('returns an object with expected keys for TESTNET', () => {
    const addr = getContractAddresses('TESTNET')
    expect(addr).toHaveProperty('RAFFLE')
    expect(addr).toHaveProperty('SOF')
    expect(addr).toHaveProperty('SOF_SMART_ACCOUNT')
  })

  it('RAFFLE_ABI is defined and non-empty array', () => {
    expect(Array.isArray(RAFFLE_ABI)).toBe(true)
    expect(RAFFLE_ABI.length).toBeGreaterThan(0)
  })
})

describe('sanitizeAddress', () => {
  it('returns empty string as-is (not configured)', () => {
    expect(sanitizeAddress('')).toBe('')
  })

  it('passes through a valid address unchanged', () => {
    const addr = '0x27C367d6b77e51E60656A2e1a24a4626D48bB25D'
    expect(sanitizeAddress(addr)).toBe(addr)
  })

  it('trims whitespace and newlines', () => {
    expect(sanitizeAddress('0x27C367d6b77e51E60656A2e1a24a4626D48bB25D\n'))
      .toBe('0x27C367d6b77e51E60656A2e1a24a4626D48bB25D')
    expect(sanitizeAddress('  0x27C367d6b77e51E60656A2e1a24a4626D48bB25D  '))
      .toBe('0x27C367d6b77e51E60656A2e1a24a4626D48bB25D')
  })

  it('strips literal backslash-n from env var corruption', () => {
    expect(sanitizeAddress('0x27C367d6b77e51E60656A2e1a24a4626D48bB25D\\n'))
      .toBe('0x27C367d6b77e51E60656A2e1a24a4626D48bB25D')
  })

  it('warns on invalid address format after sanitization', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = sanitizeAddress('not-an-address')
    expect(result).toBe('')
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid contract address')
    )
    spy.mockRestore()
  })

  it('warns on address with wrong length', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = sanitizeAddress('0x1234')
    expect(result).toBe('')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
