import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import seasonRoutes from '../../fastify/routes/seasonRoutes.js';

vi.mock('../../shared/supabaseClient.js', () => ({
  db: {
    getActiveSeasonContracts: vi.fn().mockResolvedValue([{ season_id: 1 }]),
    getAllSeasonContracts: vi.fn().mockResolvedValue([
      { season_id: 2, status: 'completed' },
      { season_id: 1, status: 'completed' },
    ]),
    getSeasonContracts: vi.fn(),
  },
}));

describe('seasonRoutes GET /all', () => {
  it('returns every season in descending order', async () => {
    const app = Fastify({ logger: false });
    await app.register(seasonRoutes, { prefix: '/api/seasons' });
    const res = await app.inject({ method: 'GET', url: '/api/seasons/all' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      { season_id: 2, status: 'completed' },
      { season_id: 1, status: 'completed' },
    ]);
  });
});
