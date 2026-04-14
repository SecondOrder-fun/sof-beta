/**
 * @file paymasterProxyRoutes.js
 * @description Paymaster routes:
 *   POST /coinbase — Proxies ERC-7677 paymaster requests to Coinbase CDP.
 *   POST /         — Backward-compatible alias for POST /coinbase.
 *   POST /session  — Issues a short-lived session token for Pimlico-sponsored txs.
 *   POST /pimlico  — Proxies ERC-7677 paymaster requests to Pimlico (session-gated).
 */

import crypto from "node:crypto";
import { redisClient } from "../../shared/redisClient.js";
import { AuthService } from "../../shared/auth.js";

const CHAIN_IDS = { TESTNET: 84532, MAINNET: 8453 };

const networkKey = (process.env.NETWORK || "LOCAL").toUpperCase();
const chainId = CHAIN_IDS[networkKey] || CHAIN_IDS.TESTNET;
const pimlicoApiKey = process.env.PIMLICO_API_KEY || "";
const pimlicoUrl = pimlicoApiKey
  ? `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${pimlicoApiKey}`
  : null;

export default async function paymasterProxyRoutes(fastify) {
  const paymasterUrl = process.env.PAYMASTER_RPC_URL;

  // ─── Coinbase CDP proxy handler ───────────────────────────────────────────

  const coinbaseHandler = async (request, reply) => {
    if (!paymasterUrl) {
      return reply.status(503).send({
        error: "Coinbase paymaster not configured",
      });
    }

    // Optional: require auth for sponsorship
    // if (!request.user) {
    //   return reply.status(401).send({ error: "Authentication required" });
    // }

    try {
      const response = await fetch(paymasterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (err) {
      fastify.log.error({ err }, "Paymaster proxy request failed");
      return reply.status(502).send({
        error: "Paymaster request failed",
      });
    }
  };

  const coinbaseRateLimit = {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
  };

  // ─── POST /coinbase — Coinbase CDP proxy ──────────────────────────────────

  fastify.post("/coinbase", {
    ...coinbaseRateLimit,
    handler: coinbaseHandler,
  });

  // ─── POST / — Backward-compatible alias ───────────────────────────────────

  fastify.post("/", {
    ...coinbaseRateLimit,
    handler: coinbaseHandler,
  });

  // ─── POST /pimlico — Pimlico proxy (session-gated) ───────────────────────

  fastify.post("/pimlico", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const sessionToken = request.query.session;
      if (!sessionToken) {
        return reply.status(401).send({ error: "Invalid or expired session" });
      }

      const redis = redisClient.getClient();
      const valid = await redis.get(`paymaster:session:${sessionToken}`);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid or expired session" });
      }

      if (!pimlicoUrl) {
        // Local dev: handle paymaster requests using the local SOFPaymaster
        const body = request.body || {};
        const method = body.method;

        if (method === "pm_getPaymasterStubData") {
          // Return stub data for gas estimation — tells the wallet "this will be sponsored"
          const { getDeployment } = await import('@sof/contracts/deployments');
          const paymasterAddr = getDeployment('local').Paymaster;
          if (!paymasterAddr) {
            return reply.status(503).send({ error: "Local paymaster not deployed — run docker compose up" });
          }

          return reply.send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              paymaster: paymasterAddr,
              paymasterData: "0x" + "00".repeat(65), // stub 65-byte signature for gas estimation
              paymasterVerificationGasLimit: "0x30000",
              paymasterPostOpGasLimit: "0x10000",
              sponsor: { name: "SecondOrder.fun", icon: "" },
              isFinal: false,
            },
          });
        }

        if (method === "pm_getPaymasterData") {
          // Sign the UserOp hash with the relay wallet to approve sponsorship
          const { getDeployment } = await import('@sof/contracts/deployments');
          const paymasterAddr = getDeployment('local').Paymaster;
          if (!paymasterAddr) {
            return reply.status(503).send({ error: "Local paymaster not deployed" });
          }

          try {
            const { privateKeyToAccount } = await import('viem/accounts');
            const relayKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
            if (!relayKey) {
              return reply.status(503).send({ error: "BACKEND_WALLET_PRIVATE_KEY not set" });
            }
            const normalizedKey = relayKey.startsWith('0x') ? relayKey : `0x${relayKey}`;
            const account = privateKeyToAccount(normalizedKey);

            // The UserOp hash is typically the second parameter in pm_getPaymasterData
            // ERC-7677 params: [userOp, entryPoint, chainId] — we need the hash of the userOp
            // For now, sign the raw params as-is — the exact format depends on what MetaMask sends
            // Log the params to see the actual structure
            fastify.log.info({ method, params: body.params }, 'Local paymaster signing request');

            // Extract the userOp hash — this may need adjustment based on actual MetaMask request format
            // The hash to sign is typically computed by the EntryPoint from the UserOp
            const userOpHash = body.params?.[1] || body.params?.[0]; // Try different positions

            let signature;
            if (typeof userOpHash === 'string' && userOpHash.startsWith('0x')) {
              signature = await account.signMessage({ message: { raw: userOpHash } });
            } else {
              // If we get the full UserOp object, we need to hash it ourselves
              // For now, sign a placeholder — this will be refined when we see the actual request
              const { keccak256, encodeAbiParameters } = await import('viem');
              const hashToSign = keccak256(encodeAbiParameters(
                [{ type: 'string' }],
                [JSON.stringify(body.params)]
              ));
              signature = await account.signMessage({ message: { raw: hashToSign } });
            }

            return reply.send({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                paymaster: paymasterAddr,
                paymasterData: signature,
              },
            });
          } catch (err) {
            fastify.log.error({ err }, 'Local paymaster signing failed');
            return reply.status(500).send({ error: "Paymaster signing failed: " + err.message });
          }
        }

        return reply.status(400).send({
          jsonrpc: "2.0",
          id: (body || {}).id,
          error: { code: -32601, message: `Unknown paymaster method: ${method}` },
        });
      }

      try {
        const response = await fetch(pimlicoUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        });

        const data = await response.json();
        return reply.status(response.status).send(data);
      } catch (err) {
        fastify.log.error({ err }, "Pimlico proxy request failed");
        return reply.status(502).send({ error: "Paymaster request failed" });
      }
    },
  });

  // ─── POST /session — Issue Pimlico session token ─────────────────────────

  fastify.post("/session", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      // Explicit auth — do not rely on global preHandler
      let user;
      try {
        user = await AuthService.authenticateRequest(request);
      } catch (err) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const sessionToken = crypto.randomUUID().replaceAll("-", "");
      const redis = redisClient.getClient();
      await redis.set(`paymaster:session:${sessionToken}`, "1", "EX", 300);

      return reply.send({ sessionToken });
    },
  });
}
