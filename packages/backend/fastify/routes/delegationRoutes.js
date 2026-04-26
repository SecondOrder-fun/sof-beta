// backend/fastify/routes/delegationRoutes.js
// POST /api/wallet/delegate — relay ERC-7702 authorization on-chain

import { createWalletClient, defineChain, http, createPublicClient } from 'viem';
import { recoverAuthorizationAddress } from 'viem/experimental';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { AuthService } from '../../shared/auth.js';
import { getChainByKey } from '../../src/config/chain.js';
import { redisClient } from '../../shared/redisClient.js';

const anvilChain = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
    public: { http: ['http://127.0.0.1:8545'] },
  },
});

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
  // Each network targets a distinct chainId so authorization replay is impossible.
  // LOCAL on Anvil (31337) was previously misconfigured to baseSepolia (84532),
  // which made the chainId guard reject every local delegation request.
  const networkUpper = NETWORK.toUpperCase();
  const viemChain =
    networkUpper === 'LOCAL'
      ? anvilChain
      : networkUpper === 'TESTNET'
      ? baseSepolia
      : base;

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

      // Validate userAddress format at system boundary
      if (typeof userAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
        return reply.code(400).send({ error: 'Invalid userAddress format' });
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

  // ─── Local-only shortcut: fake-delegate via anvil_setCode ──────────────
  // MetaMask doesn't expose eth_signAuthorization for arbitrary delegates on
  // arbitrary chains, and viem's signAuthorization isn't implemented for
  // JSON-RPC accounts. To still exercise the full sponsored-UserOp path on
  // local Anvil, we shortcut the type-0x04 protocol entirely: anvil_setCode
  // injects the 0xef0100<smartAccount> delegation designator at the user's
  // EOA. The EVM treats this byte-for-byte the same as a real 7702
  // delegation, so the rest of the stack (SOFSmartAccount.validateUserOp,
  // paymaster verification, bundler handleOps) is exercised exactly as it
  // would be in production.
  if (networkUpper === 'LOCAL') {
    fastify.post('/delegate-shortcut', {
      handler: async (request, reply) => {
        const { userAddress } = request.body || {};
        if (typeof userAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
          return reply.code(400).send({ error: 'Invalid userAddress format' });
        }

        const designator = `0xef0100${sofSmartAccount.slice(2).toLowerCase()}`;

        try {
          // anvil_setCode is exposed by Anvil on its JSON-RPC; viem doesn't
          // wrap it directly, so call via raw fetch.
          const rpcUrl = chain.rpcUrl || 'http://127.0.0.1:8545';
          const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'anvil_setCode',
              params: [userAddress, designator],
            }),
          });
          const body = await res.json();
          if (body.error) {
            return reply
              .code(500)
              .send({ error: `anvil_setCode failed: ${body.error.message}` });
          }
          fastify.log.info(
            { userAddress, designator },
            '[delegate-shortcut] injected 7702 delegation via anvil_setCode',
          );
          return reply.send({ status: 'shortcut', designator, target: sofSmartAccount });
        } catch (err) {
          fastify.log.error({ err: err.message, userAddress }, 'shortcut delegation failed');
          return reply.code(500).send({ error: err.message });
        }
      },
    });
  }
}
