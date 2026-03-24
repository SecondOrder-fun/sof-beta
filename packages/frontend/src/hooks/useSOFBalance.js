// src/hooks/useSOFBalance.js
import { useAccount, useReadContract } from "wagmi";
import { CONTRACTS } from "@/config/contracts";

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
];

/**
 * Hook to get the connected user's $SOF balance
 * @returns {{ balance: bigint, isLoading: boolean, refetch: function }}
 */
export function useSOFBalance() {
  const { address, isConnected } = useAccount();
  const network = (import.meta.env.VITE_DEFAULT_NETWORK || "TESTNET").toUpperCase();
  const sofAddress = CONTRACTS[network]?.SOF;

  const { data, isLoading, refetch } = useReadContract({
    address: sofAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
    query: {
      enabled: isConnected && !!address && !!sofAddress,
    },
  });

  return {
    balance: data ?? BigInt(0),
    isLoading,
    refetch,
  };
}

export default useSOFBalance;
