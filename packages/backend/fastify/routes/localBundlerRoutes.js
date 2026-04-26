// Local ERC-4337 bundler + ERC-7677 paymaster JSON-RPC endpoint.
// Serves what Pimlico serves in production, but backed by the backend relay
// wallet + EntryPoint.handleOps on a local Anvil node. Used only when
// NETWORK=LOCAL — testnet/mainnet continue to use Pimlico.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { defineChain } from "viem";
import { createBundlerService } from "../../shared/aa/bundler.js";
import { redisClient } from "../../shared/redisClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function anvilChain() {
  return defineChain({
    id: 31337,
    name: "Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["http://127.0.0.1:8545"] },
      public: { http: ["http://127.0.0.1:8545"] },
    },
  });
}

export default async function localBundlerRoutes(fastify) {
  const network = (process.env.NETWORK || "LOCAL").toUpperCase();
  if (network !== "LOCAL") {
    fastify.log.info("[local-bundler] skipping — NETWORK != LOCAL");
    return;
  }

  const relayKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
  if (!relayKey) {
    fastify.log.warn("[local-bundler] BACKEND_WALLET_PRIVATE_KEY not set — endpoint disabled");
    return;
  }

  // Paymaster address: prefer env (set by tests / overrides), fall back to
  // the canonical local deployment file. readFileSync + JSON.parse avoids
  // import-assertion syntax churn across Node versions, and lets us log the
  // failure mode explicitly instead of silently disabling the endpoint.
  let paymasterAddress = process.env.PAYMASTER_ADDRESS;
  if (!paymasterAddress) {
    const deploymentPath = resolve(
      __dirname,
      "../../../contracts/deployments/local.json",
    );
    try {
      const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
      paymasterAddress = deployment?.contracts?.Paymaster;
    } catch (err) {
      fastify.log.warn(
        { err: err.message, path: deploymentPath },
        "[local-bundler] failed to read deployment file",
      );
    }
  }
  if (!paymasterAddress) {
    fastify.log.warn("[local-bundler] no Paymaster address known — endpoint disabled");
    return;
  }

  const rpcUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";

  // Redis is wired even on LOCAL (where quota is force-disabled, so this is
  // a no-op) so the same construction shape works once the same factory is
  // mounted from a testnet/mainnet route. Keeps the prod wire-up to a single
  // route registration rather than threading redis through later.
  let redis = null;
  try {
    redis = redisClient.getClient();
  } catch (err) {
    fastify.log.warn(
      { err: err.message },
      "[local-bundler] redis client unavailable — quota will be skipped",
    );
  }

  const svc = createBundlerService({
    rpcUrl,
    chain: anvilChain(),
    relayKey,
    paymasterAddress,
    redis,
  });

  fastify.log.info(
    { paymaster: paymasterAddress, relay: svc._relayAddress, entryPoint: svc._entryPointAddress },
    "[local-bundler] ready",
  );

  // Single JSON-RPC endpoint serves both pm_* and eth_* methods. This mirrors
  // Pimlico's combined bundler+paymaster URL that permissionless.js already
  // points at via `createSmartAccountClient({ bundlerTransport: http(URL), paymaster: pimlicoClient({ transport: http(URL) }) })`.
  const handler = async (request, reply) => {
    const payload = request.body;
    const respond = (result) =>
      reply.send({ jsonrpc: "2.0", id: payload?.id ?? null, result });
    const respondError = (code, message) =>
      reply.send({ jsonrpc: "2.0", id: payload?.id ?? null, error: { code, message } });

    if (!payload || payload.jsonrpc !== "2.0" || !payload.method) {
      return respondError(-32600, "Invalid JSON-RPC request");
    }

    const method = payload.method;
    const params = Array.isArray(payload.params) ? payload.params : [];

    try {
      switch (method) {
        case "eth_chainId":
          return respond(svc.eth_chainId());
        case "eth_supportedEntryPoints":
          return respond(svc.eth_supportedEntryPoints());
        case "pm_getPaymasterStubData": {
          const [userOp /* , entryPoint, chainId, context */] = params;
          return respond(await svc.pm_getPaymasterStubData(userOp));
        }
        case "pm_getPaymasterData": {
          const [userOp /* , entryPoint, chainId, context */] = params;
          return respond(await svc.pm_getPaymasterData(userOp));
        }
        case "eth_estimateUserOperationGas":
          return respond(await svc.eth_estimateUserOperationGas(params[0]));
        case "eth_sendUserOperation": {
          const [userOp /* , entryPoint */] = params;
          const userOpHash = await svc.eth_sendUserOperation(userOp);
          return respond(userOpHash);
        }
        case "eth_getUserOperationReceipt":
          return respond(await svc.eth_getUserOperationReceipt(params[0]));
        case "eth_getUserOperationByHash":
          return respond(await svc.eth_getUserOperationByHash(params[0]));
        default:
          return respondError(-32601, `Method not found: ${method}`);
      }
    } catch (err) {
      request.log.error({ err, method }, "[local-bundler] handler failed");
      const code = typeof err?.code === "number" ? err.code : -32000;
      return respondError(code, err?.shortMessage || err?.message || "bundler error");
    }
  };

  fastify.post("/", { handler });
  // Also accept GET-style probes; some tooling sniffs with eth_chainId.
  fastify.get("/chain-id", async () => ({ chainId: svc.eth_chainId() }));
}
