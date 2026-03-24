/**
 * Export initial chain for RainbowKit configuration.
 */
import { getChainConfig, getStoredNetworkKey } from "@/lib/wagmi";

const initialNetworkKey = (() => {
  try {
    return getStoredNetworkKey();
  } catch {
    return "TESTNET";
  }
})();

const activeChainConfig = getChainConfig(initialNetworkKey);

export const getInitialChain = () => activeChainConfig.chain;

export const getRainbowKitChains = () => [activeChainConfig.chain];
