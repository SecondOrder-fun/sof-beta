// SOFPaymaster ERC-7677 service endpoint.
//
// Mounted on every NETWORK (LOCAL/TESTNET/MAINNET). Exposes only the
// paymaster-specific JSON-RPC surface:
//
//   pm_getPaymasterStubData
//   pm_getPaymasterData
//   eth_chainId            (liveness probe)
//   eth_supportedEntryPoints
//
// Full-bundler methods (eth_sendUserOperation, eth_estimateUserOperationGas,
// eth_getUserOperationReceipt) return -32601 — Pimlico is the bundler in
// production; this endpoint signs paymaster sponsorship via SOFPaymaster's
// verifyingSigner. localBundlerRoutes.js (LOCAL only) provides the full
// bundler surface for dev where Pimlico isn't available.
//
// All hardening (bounded validUntil, gas caps, per-EOA quota) flows through
// the existing createBundlerService factory — see
// packages/backend/shared/aa/bundler.js and
// docs/02-architecture/paymaster-signer-rotation.md.

import { defineChain, isAddress } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { createBundlerService } from "../../shared/aa/bundler.js";
import { redisClient } from "../../shared/redisClient.js";

/**
 * Pick the chain definition for the configured network.
 *
 * RPC URL:
 *   LOCAL   — LOCAL_RPC_URL || http://127.0.0.1:8545
 *   TESTNET — BASE_SEPOLIA_RPC_URL (REQUIRED — no public fallback)
 *   MAINNET — BASE_MAINNET_RPC_URL (REQUIRED — no public fallback)
 *
 * The public Base RPCs (sepolia.base.org / mainnet.base.org) have aggressive
 * rate limits; under any real load the paymaster would degrade silently to
 * AA-style errors. Better to fail at boot than at the first sponsored op.
 */
function pickChain(network) {
  switch (network) {
    case "LOCAL":
      return defineChain({
        id: 31337,
        name: "Anvil",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545"] },
        },
      });
    case "TESTNET": {
      const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
      if (!rpcUrl) {
        throw new Error(
          "BASE_SEPOLIA_RPC_URL not set — set a private RPC endpoint (Alchemy / Quicknode / etc.). Public sepolia.base.org rate-limits aggressively and would silently degrade sponsorship.",
        );
      }
      return defineChain({
        id: 84532,
        name: "Base Sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
    }
    case "MAINNET": {
      const rpcUrl = process.env.BASE_MAINNET_RPC_URL;
      if (!rpcUrl) {
        throw new Error(
          "BASE_MAINNET_RPC_URL not set — set a private RPC endpoint (Alchemy / Quicknode / etc.). Public mainnet.base.org rate-limits aggressively and would silently degrade sponsorship.",
        );
      }
      return defineChain({
        id: 8453,
        name: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
    }
    default:
      throw new Error(`Unknown NETWORK: ${network}. Expected LOCAL | TESTNET | MAINNET.`);
  }
}

/**
 * Resolve the SOFPaymaster contract address for the configured network.
 *
 * Order:
 *   1. PAYMASTER_ADDRESS env override (useful for testnet pre-deploy + tests).
 *   2. @sof/contracts/deployments file for the network.
 *
 * Returns null if neither is available OR the value isn't a valid 0x-address —
 * callers must surface a clear error rather than silently signing with a
 * bogus paymaster (which would fail at AA34 only on the user's submit path).
 */
async function resolvePaymasterAddress(network, log) {
  const fromEnv = process.env.PAYMASTER_ADDRESS;
  if (fromEnv) {
    if (!isAddress(fromEnv)) {
      log?.warn?.(
        { value: fromEnv },
        "[paymaster-service] PAYMASTER_ADDRESS env is not a valid address — ignoring",
      );
    } else {
      return fromEnv;
    }
  }
  try {
    const { getDeployment } = await import("@sof/contracts/deployments");
    const contracts = getDeployment(network.toLowerCase());
    const fromFile = contracts?.Paymaster;
    if (fromFile && !isAddress(fromFile)) {
      log?.warn?.(
        { value: fromFile, network },
        "[paymaster-service] deployments file Paymaster is not a valid address — ignoring",
      );
      return null;
    }
    return fromFile ?? null;
  } catch {
    return null;
  }
}

export default async function paymasterServiceRoutes(fastify) {
  const network = (process.env.NETWORK || "LOCAL").toUpperCase();
  const isLocalNetwork = network === "LOCAL";

  let chain;
  try {
    chain = pickChain(network);
  } catch (err) {
    fastify.log.error(
      { err: err.message, network },
      "[paymaster-service] cannot pick chain — endpoint disabled",
    );
    return; // refuse to mount on a misconfigured deploy
  }

  const paymasterAddress = await resolvePaymasterAddress(network, fastify.log);
  if (!paymasterAddress) {
    fastify.log.warn(
      { network },
      "[paymaster-service] no Paymaster address resolved — pm_* will return -32603 until deploy lands",
    );
  }

  const relayKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
  if (!relayKey) {
    if (!isLocalNetwork) {
      // On TESTNET/MAINNET this is a misconfigured deploy. Don't silently
      // 404 the route — mount a stub that returns -32603 with a clear
      // message so monitoring picks it up immediately.
      fastify.log.error(
        { network },
        "[paymaster-service] BACKEND_WALLET_PRIVATE_KEY not set on remote — paymaster cannot sign",
      );
      const stubHandler = async (request, reply) => {
        reply.send({
          jsonrpc: "2.0",
          id: request.body?.id ?? null,
          error: {
            code: -32603,
            message:
              "Paymaster service not configured: BACKEND_WALLET_PRIVATE_KEY missing.",
            data: { reason: "relay_key_missing" },
          },
        });
      };
      fastify.post("/", { handler: stubHandler });
      fastify.get("/chain-id", async () => ({ chainId: chain.id }));
      return;
    }
    fastify.log.warn(
      "[paymaster-service] BACKEND_WALLET_PRIVATE_KEY not set on LOCAL — endpoint disabled",
    );
    return;
  }

  // Wire redis so PR #28's per-EOA quota fires. On LOCAL the quota is
  // force-disabled inside the factory, so this is a no-op there but
  // matches the production shape exactly.
  let redis = null;
  try {
    redis = redisClient.getClient();
  } catch (err) {
    fastify.log.warn(
      { err: err.message },
      "[paymaster-service] redis unavailable — quota will fail-closed on remote",
    );
  }

  // Build the service if we have a paymaster. If not, mount a degraded
  // route that still answers eth_chainId (liveness) but returns -32603 from
  // pm_* until the contract is deployed.
  const svc = paymasterAddress
    ? createBundlerService({
        rpcUrl: chain.rpcUrls.default.http[0],
        chain,
        relayKey,
        paymasterAddress,
        redis,
      })
    : null;

  fastify.log.info(
    {
      network,
      chainId: chain.id,
      paymaster: paymasterAddress ?? "<unresolved>",
      relay: privateKeyToAccount(
        relayKey.startsWith("0x") ? relayKey : `0x${relayKey}`,
      ).address,
    },
    "[paymaster-service] ready",
  );

  // Methods this endpoint serves. Anything outside this set returns -32601
  // — Pimlico is the production bundler; we only sign paymaster data.
  const PAYMASTER_METHODS = new Set([
    "eth_chainId",
    "eth_supportedEntryPoints",
    "pm_getPaymasterStubData",
    "pm_getPaymasterData",
  ]);

  const handler = async (request, reply) => {
    const payload = request.body;
    const respond = (result) =>
      reply.send({ jsonrpc: "2.0", id: payload?.id ?? null, result });
    const respondError = (code, message, data) =>
      reply.send({
        jsonrpc: "2.0",
        id: payload?.id ?? null,
        error: data ? { code, message, data } : { code, message },
      });

    if (!payload || payload.jsonrpc !== "2.0" || !payload.method) {
      return respondError(-32600, "Invalid JSON-RPC request");
    }

    const { method } = payload;
    const params = Array.isArray(payload.params) ? payload.params : [];

    if (!PAYMASTER_METHODS.has(method)) {
      return respondError(
        -32601,
        `Method not found: ${method}. This endpoint serves paymaster (pm_*) methods only — full bundler surface is provided by Pimlico in production.`,
      );
    }

    // chainId / supportedEntryPoints don't need the service object — they
    // answer from the static config so liveness probes work even when the
    // paymaster contract isn't deployed yet.
    try {
      if (method === "eth_chainId") {
        return respond(`0x${chain.id.toString(16)}`);
      }
      if (method === "eth_supportedEntryPoints") {
        return respond([entryPoint08Address]);
      }
      // Anything past this point requires the signed-paymaster service.
      if (!svc) {
        return respondError(
          -32603,
          `Paymaster not deployed on ${network}. Deploy SOFPaymaster and either commit it to deployments/${network.toLowerCase()}.json or set PAYMASTER_ADDRESS.`,
          { reason: "paymaster_not_deployed" },
        );
      }
      // Both pm_* methods take [userOp, entryPoint, chainId, context] in
      // ERC-7677. Validate userOp shape before dispatching so a malformed
      // wallet probe gets a -32602 (invalid params) rather than a generic
      // -32000 from the factory's normalizeUserOp throwing.
      if (method === "pm_getPaymasterStubData" || method === "pm_getPaymasterData") {
        const [op] = params;
        if (!op || typeof op !== "object" || Array.isArray(op)) {
          return respondError(-32602, `${method}: missing or invalid userOp param`);
        }
        if (typeof op.sender !== "string") {
          return respondError(-32602, `${method}: userOp missing sender`);
        }
        if (method === "pm_getPaymasterStubData") {
          return respond(await svc.pm_getPaymasterStubData(op));
        }
        return respond(await svc.pm_getPaymasterData(op));
      }
      // Unreachable — PAYMASTER_METHODS gate above already rejects everything else.
      return respondError(-32601, `Method not found: ${method}`);
    } catch (err) {
      request.log.error({ err, method }, "[paymaster-service] handler failed");
      const code = typeof err?.code === "number" ? err.code : -32000;
      return respondError(code, err?.shortMessage || err?.message || "paymaster error");
    }
  };

  fastify.post("/", { handler });
  fastify.get("/chain-id", async () => ({ chainId: chain.id }));
}
