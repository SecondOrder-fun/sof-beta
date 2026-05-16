import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

// Mock viemClient before importing routes
vi.mock('../../src/lib/viemClient.js', () => ({
  chainTimeCache: {
    blockNumber: null,
    timestamp: null,
    updatedAt: null,
  },
}));

import chainTimeRoutes from '../../fastify/routes/chainTimeRoutes.js';
import { chainTimeCache } from '../../src/lib/viemClient.js';

describe('chainTimeRoutes', () => {
  let app;
  beforeEach(async () => {
    chainTimeCache.blockNumber = null;
    chainTimeCache.timestamp = null;
    chainTimeCache.updatedAt = null;
    app = Fastify({ logger: false });
    await app.register(chainTimeRoutes, { prefix: '/api/chain' });
  });

  it('returns 503 when cache is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chain/time' });
    expect(res.statusCode).toBe(503);
  });

  it('returns cached chain time', async () => {
    chainTimeCache.blockNumber = 12345;
    chainTimeCache.timestamp = 1700000000;
    chainTimeCache.updatedAt = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/chain/time' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.blockNumber).toBe(12345);
    expect(body.timestamp).toBe(1700000000);
    expect(typeof body.cachedAt).toBe('number');
  });
});
