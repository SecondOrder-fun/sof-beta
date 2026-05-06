// src/context/WagmiConfigProvider.jsx
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  WagmiProvider,
  useAccount,
  useChainId,
  useConnect,
  useSwitchChain,
} from "wagmi";
import { getChainConfig, getStoredNetworkKey } from "@/lib/wagmi";
import { config, initialNetworkKey } from "@/lib/wagmiConfig";

// Re-export config for backwards compatibility with existing imports
export { config } from "@/lib/wagmiConfig";

/**
 * Auto-connect component for Farcaster/Base App
 * Automatically connects using the Farcaster connector when in a MiniApp context
 */
const FarcasterAutoConnect = () => {
  const { connect, connectors } = useConnect();
  const [hasAttempted, setHasAttempted] = useState(false);

  useEffect(() => {
    if (hasAttempted) return;

    const autoConnect = async () => {
      try {
        // Dynamically import SDK to check if we're in Farcaster
        const { sdk } = await import("@farcaster/miniapp-sdk");
        const ctx = await sdk.context;

        if (ctx) {
          // We're in a Farcaster client - find and use the Farcaster connector
          const farcasterConnector = connectors.find((c) => {
            const id = typeof c?.id === "string" ? c.id.toLowerCase() : "";
            const name =
              typeof c?.name === "string" ? c.name.toLowerCase() : "";
            return id.includes("farcaster") || name.includes("farcaster");
          });
          if (farcasterConnector) {
            connect({ connector: farcasterConnector });
          }
          // Signal Mini App is ready to prevent stuck loading screen
          // Per dTech docs: must call ready() after context detection
          sdk.actions.ready();
        }
      } catch {
        // Not in Farcaster client - no auto-connect
      }
      setHasAttempted(true);
    };

    autoConnect();
  }, [connect, connectors, hasAttempted]);

  return null;
};

const EnsureActiveChain = () => {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [hasAttempted, setHasAttempted] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      setHasAttempted(false);
      return;
    }
    if (hasAttempted) return;

    let targetChainId;
    try {
      const activeNetworkKey = getStoredNetworkKey();
      targetChainId = getChainConfig(activeNetworkKey).chain.id;
    } catch {
      targetChainId = null;
    }

    if (!targetChainId || chainId === targetChainId) {
      setHasAttempted(true);
      return;
    }

    try {
      switchChain({ chainId: targetChainId });
    } catch {
      // Some connectors/environments may not support programmatic switching.
    }

    setHasAttempted(true);
  }, [chainId, hasAttempted, isConnected, switchChain]);

  return null;
};

export const WagmiConfigProvider = ({ children }) => {
  useEffect(() => {
    const handleNetworkChange = (event) => {
      try {
        // Store the new network key
        const newNetworkKey = event.detail.key;
        // Note: Network changes require page reload to apply new chain config
        // This is intentional to prevent MetaMask provider re-initialization
        if (newNetworkKey !== initialNetworkKey) {
          window.location.reload();
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error handling network change:", error);
      }
    };

    window.addEventListener("sof:network-changed", handleNetworkChange);
    return () => {
      window.removeEventListener("sof:network-changed", handleNetworkChange);
    };
  }, []);

  return (
    <WagmiProvider config={config}>
      <FarcasterAutoConnect />
      <EnsureActiveChain />
      {children}
    </WagmiProvider>
  );
};

WagmiConfigProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
