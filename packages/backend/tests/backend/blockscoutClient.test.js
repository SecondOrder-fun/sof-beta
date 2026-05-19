import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlockscoutClient } from '../../src/services/blockscoutClient.js';

const noopLogger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

describe('blockscoutClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects endpoints not in the whitelist', async () => {
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
    });
    await expect(
      client.fetch('arbitrary/path', {})
    ).rejects.toThrow(/whitelist/i);
  });

  it('serves whitelisted endpoint and caches the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ address: '0xabc' }] }),
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
      cacheTtlsMs: { 'tokens/:address/holders': 300 },
    });
    const first = await client.fetch('tokens/:address/holders', { address: '0xToken' });
    const second = await client.fetch('tokens/:address/holders', { address: '0xToken' });
    expect(first).toEqual({ items: [{ address: '0xabc' }] });
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);   // cached
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/v2/tokens/0xToken/holders');
  });

  it('forwards remaining params as query string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
    });
    await client.fetch('tokens/:address/transfers', { address: '0xT', page: '2' });
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toContain('/api/v2/tokens/0xT/transfers');
    expect(url).toContain('page=2');
  });

  it('throws normalized error on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'upstream down',
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
    });
    await expect(
      client.fetch('tokens/:address/holders', { address: '0xT' })
    ).rejects.toThrow(/502/);
  });

  it('respects per-endpoint TTL', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 1 }),
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
      cacheTtlsMs: { 'transactions/:hash': 5_000 },
    });
    await client.fetch('transactions/:hash', { hash: '0x1' });
    vi.advanceTimersByTime(6_000);
    await client.fetch('transactions/:hash', { hash: '0x1' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
