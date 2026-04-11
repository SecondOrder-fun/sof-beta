// backend/fastify/routes/delegationRoutes.js
// POST /api/wallet/delegate — relay ERC-7702 authorization on-chain

import { createWalletClient, http, createPublicClient } from 'viem';
import { recoverAuthorizationAddress } from 'viem/experimental';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { AuthService } from '../../shared/auth.js';
import { getChainByKey } from '../../src/config/chain.js';
import { redisClient } from '../../shared/redisClient.js';

const NETWORK = process.env.NETWORK || 'LOCAL';
const RATE_LIMIT_MAX = 2;
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

export default async function delegationRoutes(fastify) {
  const chain = getChainByKey(NETWORK);
  const sofSmartAccount = chain.sofSmartAccount;

  if (!sofSmartAccount) {
    fastify.log.warn('[delegation] SOFSmartAccount address not configured — delegation endpoint disabled');
    return;
  }

  // Initialize relay wallet
  const relayKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
  if (!relayKey) {
    fastify.log.warn('[delegation] BACKEND_WALLET_PRIVATE_KEY not set — delegation endpoint disabled');
    return;
  }

  const normalizedKey = relayKey.startsWith('0x') ? relayKey : `0x${relayKey}`;
  const relayAccount = privateKeyToAccount(normalizedKey);
  const isTestnet = NETWORK.toUpperCase() === 'TESTNET' || NETWORK.toUpperCase() === 'LOCAL';
  const viemChain = isTestnet ? baseSepolia : base;

  const walletClient = createWalletClient({
    account: relayAccount,
    chain: viemChain,
    transport: http(chain.rpcUrl || undefined),
  });

  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpcUrl || undefined),
  });

  fastify.post('/delegate', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      // 1. Authenticate
      const user = await AuthService.authenticateRequest(request);
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // 2. Parse and validate input
      const { authorization, userAddress } = request.body || {};
      if (!authorization || !userAddress) {
        return reply.code(400).send({ error: 'Missing authorization or userAddress' });
      }

      const authTarget = (authorization.address || '').toLowerCase();
      if (authTarget !== sofSmartAccount.toLowerCase()) {
        return reply.code(400).send({ error: 'Invalid authorization target — must be SOFSmartAccount' });
      }

      // Validate chainId — reject chainId=0 (any-chain) to prevent cross-chain replay
      const authChainId = Number(authorization.chainId || 0);
      if (authChainId === 0) {
        return reply.code(400).send({ error: 'Authorization must specify a chainId (chainId=0 not allowed)' });
      }
      if (authChainId !== viemChain.id) {
        return reply.code(400).send({ error: `Authorization chainId (${authChainId}) does not match expected chain (${viemChain.id})` });
      }

      // 3. Verify the authorization signature recovers to the claimed user address
      try {
        const recovered = await recoverAuthorizationAddress({ authorization });
        if (recovered.toLowerCase() !== userAddress.toLowerCase()) {
          return reply.code(400).send({ error: 'Authorization signature does not match userAddress' });
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to recover authorization address');
        return reply.code(400).send({ error: 'Invalid authorization signature' });
      }

      // 4. Per-address rate limit via Redis (2 per hour)
      const redis = redisClient.getClient();
      const rateLimitKey = `delegation:rate:${userAddress.toLowerCase()}`;
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
      }
      if (count > RATE_LIMIT_MAX) {
        return reply.code(429).send({ error: 'Rate limit exceeded — max 2 delegations per hour' });
      }

      // 5. Submit the type-0x04 transaction with authorization list
      const maxRetries = 3;
      const retryDelays = [2000, 5000, 10000];

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const hash = await walletClient.sendTransaction({
            authorizationList: [authorization],
            to: userAddress,
            data: '0x',
            value: 0n,
          });

          fastify.log.info({ hash, userAddress, attempt }, 'Delegation tx submitted');

          // Fire-and-forget receipt monitoring
          publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
            .then(receipt => {
              fastify.log.info({ hash, status: receipt.status }, 'Delegation tx confirmed');
            })
            .catch(err => {
              fastify.log.error({ hash, err: err.message }, 'Delegation tx receipt failed');
            });

          return reply.send({ txHash: hash, status: 'submitted' });
        } catch (err) {
          fastify.log.error({ err: err.message, attempt, userAddress }, 'Delegation tx attempt failed');
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
          }
        }
      }

      return reply.code(500).send({ error: 'Failed to submit delegation transaction after retries' });
    },
  });
}
