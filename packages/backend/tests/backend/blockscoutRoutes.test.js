import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import blockscoutRoutes from '../../fastify/routes/blockscoutRoutes.js';

function buildApp(clientFetch) {
  const app = Fastify({ logger: false });
  app.register(blockscoutRoutes, {
    prefix: '/api/blockscout',
    blockscoutClient: { fetch: clientFetch },
  });
  return app;
}

describe('blockscoutRoutes', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('GET /tokens/:address/holders forwards to client and returns JSON', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ items: [] });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/tokens/0xAbc/holders' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [] });
    expect(clientFetch).toHaveBeenCalledWith('tokens/:address/holders', { address: '0xAbc' });
  });

  it('GET /tokens/:address/transfers forwards query params', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ items: [] });
    const app = buildApp(clientFetch);
    const res = await app.inject({
      method: 'GET',
      url: '/api/blockscout/tokens/0xAbc/transfers?page=2',
    });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('tokens/:address/transfers', { address: '0xAbc', page: '2' });
  });

  it('GET /addresses/:address/transactions works', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ items: [] });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/addresses/0xUser/transactions' });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('addresses/:address/transactions', { address: '0xUser' });
  });

  it('GET /transactions/:hash works', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ hash: '0x1' });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/transactions/0x1' });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('transactions/:hash', { hash: '0x1' });
  });

  it('GET /addresses/:address works', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ hash: '0xUser' });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/addresses/0xUser' });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('addresses/:address', { address: '0xUser' });
  });

  it('returns 502 when client throws non-retryable', async () => {
    const clientFetch = vi.fn().mockRejectedValue(Object.assign(new Error('upstream'), { status: 404 }));
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/tokens/0xA/holders' });
    expect(res.statusCode).toBe(502);
  });
});
