import { chainTimeCache } from '../../src/lib/viemClient.js';

export default async function chainTimeRoutes(fastify) {
  fastify.get('/time', async (_request, reply) => {
    if (chainTimeCache.blockNumber == null || chainTimeCache.timestamp == null) {
      return reply.status(503).send({ error: 'chain time not yet cached' });
    }
    return {
      blockNumber: chainTimeCache.blockNumber,
      timestamp: chainTimeCache.timestamp,
      cachedAt: chainTimeCache.updatedAt,
    };
  });
}
