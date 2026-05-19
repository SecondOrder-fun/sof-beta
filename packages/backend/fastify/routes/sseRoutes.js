/**
 * @file sseRoutes.js
 * @description Fastify routes for Server-Sent Events (SSE)
 * Provides per-domain real-time updates (raffle, infofi, rollover)
 * @author SecondOrder.fun
 */

import { getSSEChannelService, CHANNELS } from '../../src/services/sseChannelService.js';

const HEARTBEAT_MS = 30_000;

function registerChannelRoute(fastify, logger, sseService, channel) {
  fastify.get(`/${channel}`, async (request, reply) => {
    const connectionId = `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });
    sseService.addConnection(channel, connectionId, reply);
    reply.raw.write(
      `data: ${JSON.stringify({
        type: 'connected',
        channel,
        connectionId,
        timestamp: new Date().toISOString(),
      })}\n\n`,
    );
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        sseService.removeConnection(channel, connectionId);
      }
    }, HEARTBEAT_MS);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      sseService.removeConnection(channel, connectionId);
    });
    request.raw.on('error', (err) => {
      logger.error(`SSE ${channel}/${connectionId} error: ${err.message}`);
      clearInterval(heartbeat);
      sseService.removeConnection(channel, connectionId);
    });
  });
}

/**
 * Register SSE routes (per-channel)
 * @async
 * @param {Object} fastify - Fastify instance (its `.log` is used for logging)
 * @returns {Promise<void>}
 */
export async function registerSSERoutes(fastify) {
  const logger = fastify.log;
  const sseService = getSSEChannelService(logger);

  for (const channel of CHANNELS) {
    registerChannelRoute(fastify, logger, sseService, channel);
  }

  fastify.get('/health', async () => ({
    status: 'ok',
    channels: Object.fromEntries(
      CHANNELS.map((c) => [c, sseService.getConnectionCount(c)]),
    ),
    timestamp: new Date().toISOString(),
  }));

  logger.info(`✅ SSE routes registered: ${CHANNELS.map((c) => `/${c}`).join(', ')}, /health`);
}

export default registerSSERoutes;
