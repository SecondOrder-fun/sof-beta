import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import curveRoutes from '../../fastify/routes/curveRoutes.js';

vi.mock('../../shared/supabaseClient.js', () => ({
  db: {
    getCurveState: vi.fn(),
  },
}));

import { db } from '../../shared/supabaseClient.js';

describe('curveRoutes', () => {
  let app;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(curveRoutes, { prefix: '/api/curve' });
  });

  it('GET /:addr/state returns curve state', async () => {
    db.getCurveState.mockResolvedValue({
      bonding_curve_address: '0xabc',
      accumulated_fees: '100',
      sof_reserves: '200',
      current_supply: '300',
      current_step_index: 2,
      current_step_price: '50',
      current_step_range_to: '1000',
    });
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xABC/state' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accumulatedFees).toBe('100');
    expect(body.sofReserves).toBe('200');
    expect(body.currentSupply).toBe('300');
    expect(body.currentStep).toEqual({ index: 2, price: '50', rangeTo: '1000' });
  });

  it('GET /:addr/state returns 404 when not found', async () => {
    db.getCurveState.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xnotfound/state' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /:addr/steps returns the bond steps array', async () => {
    db.getCurveState.mockResolvedValue({
      bonding_curve_address: '0xabc',
      bond_steps: [{ rangeTo: '100', price: '1' }, { rangeTo: '200', price: '2' }],
    });
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xabc/steps' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      { rangeTo: '100', price: '1' },
      { rangeTo: '200', price: '2' },
    ]);
  });

  it('GET /:addr/treasury returns the treasury slice', async () => {
    db.getCurveState.mockResolvedValue({
      accumulated_fees: '500',
      sof_reserves: '1000',
      treasury_address: '0xdef',
    });
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xabc/treasury' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      accumulatedFees: '500',
      sofReserves: '1000',
      treasuryAddress: '0xdef',
    });
  });
});
