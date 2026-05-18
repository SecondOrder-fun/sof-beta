// In-memory cache for the SOF token's immutable metadata (address, decimals,
// symbol). The decimals are fixed at deployment time and never change, so
// the cache is populated once at backend startup via fetchSofMetadata() and
// served by /api/token/sof. Frontend hooks read this through the warm tier
// instead of firing their own eth_call on every page mount.

import { getDeployment } from "@sof/contracts";

export const sofMetadataCache = {
  address: null,
  decimals: null,
  symbol: null,
  updatedAt: null,
};

export function updateSofMetadataCache({ address, decimals, symbol }) {
  sofMetadataCache.address = address;
  sofMetadataCache.decimals = decimals;
  sofMetadataCache.symbol = symbol;
  sofMetadataCache.updatedAt = Date.now();
}

// SOFToken ERC20 metadata. The address comes from the deployment JSON; the
// decimals/symbol are read from the chain once and cached. Safe to call
// multiple times — only refreshes if the cache is empty.
export async function fetchSofMetadata({ publicClient, network, logger }) {
  if (sofMetadataCache.decimals != null) return sofMetadataCache;

  const deployment = getDeployment(network);
  const address = deployment?.SOFToken;
  if (!address) {
    throw new Error(`SOFToken address missing from deployment ${network}`);
  }

  const erc20Abi = [
    { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  ];

  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => "SOF"),
  ]);

  updateSofMetadataCache({
    address,
    decimals: Number(decimals),
    symbol,
  });

  logger?.info?.({ address, decimals: Number(decimals), symbol }, "SOF metadata cached");
  return sofMetadataCache;
}
