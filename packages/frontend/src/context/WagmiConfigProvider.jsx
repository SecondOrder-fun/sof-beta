// src/context/WagmiConfigProvider.jsx
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  WagmiProvider,
  useAccount,
  useChainId,
  useConnect,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { getChainConfig, getStoredNetworkKey } from "@/lib/wagmi";
import { config, initialNetworkKey } from "@/lib/wagmiConfig";
import { useDelegationStatus } from "@/hooks/useDelegationStatus";
import { DelegationModal } from "@/components/delegation/DelegationModal";

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

const OPT_OUT_PREFIX = "sof:delegation-opt-out:";

const DelegationGate = () => {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { isDelegated, isSOFDelegate, isLoading } = useDelegationStatus();
  const [showModal, setShowModal] = useState(false);
  // Track which address we already evaluated rather than a boolean flag.
  // The original `hasChecked` boolean wasn't reset on wallet-switch (only on
  // explicit disconnect), so connecting Rabby right after MetaMask used the
  // stale "checked" state and skipped the modal silently. Per-address
  // tracking re-runs the check whenever the connected address changes.
  const [checkedAddress, setCheckedAddress] = useState(null);

  useEffect(() => {
    if (!isConnected || !address || !walletClient || isLoading) return;
    if (checkedAddress?.toLowerCase() === address.toLowerCase()) return;

    // Skip Coinbase Wallet (already smart)
    if (connector?.id === "coinbaseWalletSDK") {
      setCheckedAddress(address);
      return;
    }

    // On testnet/mainnet MetaMask handles EIP-7702 internally via wallet_sendCalls
    // (atomicRequired triggers a built-in upgrade prompt). On local Anvil
    // (chain 31337) MetaMask has no native AA flow, so we drive the 7702
    // authorization ourselves through the DelegationModal + backend relay.
    const isLocalChain = chainId === 31337;
    if (
      !isLocalChain &&
      (connector?.id === "metaMaskSDK" || connector?.id === "io.metamask")
    ) {
      setCheckedAddress(address);
      return;
    }

    // Skip if already delegated to our contract
    if (isSOFDelegate) {
      setCheckedAddress(address);
      return;
    }

    // Skip if delegated to a non-SOF target (don't overwrite some other
    // protocol's delegation on the user's EOA). Exception: local Anvil, where
    // SOFSmartAccount gets a fresh address on every contract redeploy and we
    // _want_ to re-prompt so the EOA points at the live SOFSmartAccount.
    if (isDelegated && !isLocalChain) {
      setCheckedAddress(address);
      return;
    }

    // Skip if this address previously opted out
    if (localStorage.getItem(`${OPT_OUT_PREFIX}${address.toLowerCase()}`) === "true") {
      setCheckedAddress(address);
      return;
    }

    // Show delegation modal
    setShowModal(true);
    setCheckedAddress(address);
  }, [address, chainId, isConnected, walletClient, isLoading, checkedAddress, connector, isDelegated, isSOFDelegate]);

  // Reset when wallet disconnects so the next connect re-evaluates.
  useEffect(() => {
    if (!isConnected) {
      setCheckedAddress(null);
      setShowModal(false);
    }
  }, [isConnected]);

  return (
    <DelegationModal
      open={showModal}
      onOpenChange={setShowModal}
      onDelegated={() => setShowModal(false)}
    />
  );
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
      <DelegationGate />
      {children}
    </WagmiProvider>
  );
};

WagmiConfigProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
