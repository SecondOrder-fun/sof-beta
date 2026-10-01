// src/context/WagmiConfigProvider.jsx
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  WagmiProvider,
  useAccount,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { getChainConfig, getStoredNetworkKey } from "@/lib/wagmi";
import { config, initialNetworkKey } from "@/lib/wagmiConfig";

// Re-export config for backwards compatibility with existing imports
export { config } from "@/lib/wagmiConfig";

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
      <EnsureActiveChain />
      {children}
    </WagmiProvider>
  );
};

WagmiConfigProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
