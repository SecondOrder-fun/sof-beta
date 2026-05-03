// src/context/WagmiConfigProvider.jsx
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  WagmiProvider,
  useAccount,
  useCapabilities,
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
  const {
    data: capabilities,
    isPending: capabilitiesPending,
    fetchStatus: capabilitiesFetchStatus,
  } = useCapabilities({ account: address });
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

    // Wait for the capabilities query to resolve before deciding. The hook
    // is async — without this guard the effect runs once with capabilities
    // === undefined, opens the modal, and `setCheckedAddress(address)` below
    // locks the gate so the second pass (with real data) never re-evaluates.
    // `fetchStatus === "idle"` covers the case where there's nothing to fetch
    // (e.g. no connector); we don't want to block the gate forever in that
    // case, so we accept either resolved or idle.
    if (capabilitiesPending && capabilitiesFetchStatus !== "idle") return;

    // Skip Coinbase Wallet (already smart)
    if (connector?.id === "coinbaseWalletSDK") {
      setCheckedAddress(address);
      return;
    }

    // On testnet/mainnet, any wallet that advertises ERC-5792 atomic batching
    // for the current chain handles EIP-7702 itself via wallet_sendCalls
    // (atomicRequired triggers the wallet's built-in upgrade prompt). On
    // local Anvil (chain 31337) no real wallet exposes this, so we drive
    // the 7702 authorization ourselves through DelegationModal + backend.
    //
    // Capabilities is the right signal, not the connector id: MetaMask shows
    // up under multiple connector ids depending on EIP-6963 / SDK routing
    // ("io.metamask", "metaMaskSDK", or plain "injected"); the old id-based
    // guard missed "injected" and let MetaMask fall through to viem's
    // signAuthorization (which throws "Account type 'json-rpc' is not
    // supported" on json-rpc accounts).
    //
    // wagmi v2's useCapabilities, when called without `chainId`, returns the
    // full result keyed by decimal chain id (viem core
    // node_modules/viem/_esm/actions/wallet/getCapabilities.js — `return
    // typeof chainId === "number" ? capabilities[chainId] : capabilities;`,
    // and the rebuild loop uses `Number(chainId2)`). So the access is
    // `capabilities[chainId]?.atomic?.status` with chainId from useChainId().
    const isLocalChain = chainId === 31337;
    const supportsAtomicBatching = !!capabilities?.[chainId]?.atomic?.status;
    if (!isLocalChain && supportsAtomicBatching) {
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
  }, [address, chainId, isConnected, walletClient, isLoading, checkedAddress, connector, capabilities, capabilitiesPending, capabilitiesFetchStatus, isDelegated, isSOFDelegate]);

  // Reset when wallet disconnects so the next connect re-evaluates.
  useEffect(() => {
    if (!isConnected) {
      setCheckedAddress(null);
      setShowModal(false);
    }
  }, [isConnected]);

  // Listen for explicit "open delegation modal" requests from anywhere in the
  // app. This is the escape hatch for cases where the on-connect gate didn't
  // fire (timing race, version-bump auto-reload, etc.) but a downstream
  // sponsored-tx flow needs the user to delegate before proceeding.
  useEffect(() => {
    const onRequest = () => {
      // Only show if connected and not already in a delegated terminal state.
      if (isConnected && address && !isSOFDelegate) {
        setShowModal(true);
      }
    };
    window.addEventListener("sof:request-delegation", onRequest);
    return () => window.removeEventListener("sof:request-delegation", onRequest);
  }, [isConnected, address, isSOFDelegate]);

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
