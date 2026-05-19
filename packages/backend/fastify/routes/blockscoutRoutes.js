function handle(blockscoutClient) {
  return async (request, reply, endpointPattern, paramsBuilder) => {
    try {
      const params = paramsBuilder(request);
      const data = await blockscoutClient.fetch(endpointPattern, params);
      return reply.code(200).send(data);
    } catch (err) {
      request.log.error({ err }, `blockscout proxy failure: ${endpointPattern}`);
      return reply.code(502).send({ error: 'Blockscout upstream failure', detail: err.message });
    }
  };
}

export default async function blockscoutRoutes(fastify, options) {
  const { blockscoutClient } = options;
  if (!blockscoutClient || typeof blockscoutClient.fetch !== 'function') {
    throw new Error('blockscoutRoutes: blockscoutClient with .fetch is required');
  }
  const h = handle(blockscoutClient);

  fastify.get('/tokens/:address/holders', async (req, reply) =>
    h(req, reply, 'tokens/:address/holders', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/tokens/:address/transfers', async (req, reply) =>
    h(req, reply, 'tokens/:address/transfers', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/addresses/:address/transactions', async (req, reply) =>
    h(req, reply, 'addresses/:address/transactions', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/addresses/:address/token-transfers', async (req, reply) =>
    h(req, reply, 'addresses/:address/token-transfers', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/transactions/:hash', async (req, reply) =>
    h(req, reply, 'transactions/:hash', (r) => ({
      hash: r.params.hash,
      ...r.query,
    })),
  );

  fastify.get('/addresses/:address', async (req, reply) =>
    h(req, reply, 'addresses/:address', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );
}
