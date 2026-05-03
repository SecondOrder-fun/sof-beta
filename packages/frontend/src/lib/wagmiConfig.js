// src/lib/wagmiConfig.js
// Wagmi config singleton — extracted to its own module to avoid circular imports.
// Multiple files need this config for imperative @wagmi/core calls (getBytecode, etc.)
// while WagmiConfigProvider also imports hooks that need this config.

import { createConfig } from "wagmi";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { getChainConfig, getStoredNetworkKey } from "@/lib/wagmi";

// Get initial network configuration
export const initialNetworkKey = (() => {
  try {
    return getStoredNetworkKey();
  } catch {
    return "TESTNET";
  }
})();

const activeChainConfig = getChainConfig(initialNetworkKey);

// RainbowKit wallets — provide mobile deep linking via WalletConnect
// Only create connectors when project ID is available (required by walletConnectWallet)
const walletProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";
const rainbowWalletConnectors = walletProjectId
  ? connectorsForWallets(
      [
        {
          groupName: "Recommended",
          // rainbowWallet was removed: it has no browser extension and only
          // produces a generic "WalletConnect"-backed connector (same id as
          // walletConnectWallet), which rendered as a duplicate row with no
          // distinguishing icon.
          // injectedWallet stays as the catch-all for EIP-1193 providers we
          // don't have a dedicated entry for (Brave, Trust extension, etc.).
          wallets: [
            coinbaseWallet,
            metaMaskWallet,
            rabbyWallet,
            walletConnectWallet,
            injectedWallet,
          ],
        },
      ],
      { appName: "SecondOrder.fun", projectId: walletProjectId },
    )
  : [];

// Create config with Farcaster auto-connect + RainbowKit wallets (with deep linking)
// Used by WagmiProvider and imperative @wagmi/core actions (e.g. getBytecode).
export const config = createConfig({
  chains: [activeChainConfig.chain],
  connectors: [farcasterMiniApp(), ...rainbowWalletConnectors],
  transports: {
    [activeChainConfig.chain.id]: activeChainConfig.transport,
  },
});
