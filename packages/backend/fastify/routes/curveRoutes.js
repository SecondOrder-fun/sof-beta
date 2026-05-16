import { db } from '../../shared/supabaseClient.js';

function lowerHex(addr) {
  return typeof addr === 'string' ? addr.toLowerCase() : addr;
}

export default async function curveRoutes(fastify) {
  fastify.get('/:address/state', async (request, reply) => {
    const { address } = request.params;
    try {
      const row = await db.getCurveState(lowerHex(address));
      if (!row) return reply.status(404).send({ error: 'curve_state not found' });
      return {
        bondingCurveAddress: row.bonding_curve_address,
        accumulatedFees: row.accumulated_fees,
        sofReserves: row.sof_reserves,
        currentSupply: row.current_supply,
        currentStep: row.current_step_index == null
          ? null
          : {
              index: row.current_step_index,
              price: row.current_step_price,
              rangeTo: row.current_step_range_to,
            },
        lastUpdatedBlock: row.last_updated_block,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      fastify.log.error(err, 'curve state lookup failed');
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/:address/steps', async (request, reply) => {
    const { address } = request.params;
    try {
      const row = await db.getCurveState(lowerHex(address));
      if (!row || !row.bond_steps) {
        return reply.status(404).send({ error: 'bond_steps not populated' });
      }
      return row.bond_steps;
    } catch (err) {
      fastify.log.error(err, 'curve steps lookup failed');
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/:address/treasury', async (request, reply) => {
    const { address } = request.params;
    try {
      const row = await db.getCurveState(lowerHex(address));
      if (!row) return reply.status(404).send({ error: 'curve_state not found' });
      return {
        accumulatedFees: row.accumulated_fees,
        sofReserves: row.sof_reserves,
        treasuryAddress: row.treasury_address,
      };
    } catch (err) {
      fastify.log.error(err, 'curve treasury lookup failed');
      return reply.status(500).send({ error: err.message });
    }
  });
}
