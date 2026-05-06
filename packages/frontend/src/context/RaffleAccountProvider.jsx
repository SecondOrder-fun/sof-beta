// packages/frontend/src/context/RaffleAccountProvider.jsx
import { createContext, useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { SOFSmartAccountFactoryABI } from "@sof/contracts";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

const RaffleAccountContext = createContext({
  eoa: undefined,
  sma: undefined,
  walletType: undefined,
  isReady: false,
});

function classifyWalletType(connectorId) {
  if (!connectorId) return undefined;
  if (connectorId === "coinbaseWalletSDK") return "coinbase-smart";
  if (connectorId.toLowerCase().includes("farcaster")) return "farcaster-miniapp";
  return "desktop-eoa";
}

export const RaffleAccountProvider = ({ children }) => {
  const { address: eoa, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const walletType = classifyWalletType(connector?.id);
  const contracts = getContractAddresses(getStoredNetworkKey());

  const needsSmaLookup = walletType === "desktop-eoa" && isConnected && !!eoa;

  const { data: derivedSma, isPending: smaPending, isError: smaError } = useReadContract({
    abi: SOFSmartAccountFactoryABI,
    address: contracts.SOF_SMART_ACCOUNT_FACTORY,
    functionName: "getAddress",
    args: eoa ? [eoa] : undefined,
    chainId,
    query: { enabled: needsSmaLookup, staleTime: 60_000 },
  });

  const value = useMemo(() => {
    if (!isConnected || !eoa) {
      return { eoa: undefined, sma: undefined, walletType: undefined, isReady: false };
    }
    if (walletType === "desktop-eoa") {
      return {
        eoa,
        sma: derivedSma,
        walletType,
        isReady: !smaPending && !smaError && !!derivedSma,
      };
    }
    // coinbase-smart and farcaster-miniapp: connected address IS the smart account
    return { eoa, sma: eoa, walletType, isReady: true };
  }, [eoa, isConnected, walletType, derivedSma, smaPending, smaError]);

  return <RaffleAccountContext.Provider value={value}>{children}</RaffleAccountContext.Provider>;
};

RaffleAccountProvider.propTypes = { children: PropTypes.node.isRequired };

export const useRaffleAccountContext = () => useContext(RaffleAccountContext);
