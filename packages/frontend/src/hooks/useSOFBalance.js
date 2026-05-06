// src/hooks/useSOFBalance.js
import { useReadContract } from "wagmi";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";

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
 * Hook to get the connected user's $SOF balance.
 *
 * Resolves at the user's smart account (spec §4.3) — gameplay balances
 * live at the SMA, not the connected EOA.
 *
 * @returns {{ balance: bigint, isLoading: boolean, refetch: function }}
 */
export function useSOFBalance() {
  const { sma: address, isReady } = useRaffleAccount();
  const sofAddress = getContractAddresses(getStoredNetworkKey()).SOF;

  const { data, isLoading, refetch } = useReadContract({
    address: sofAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
    query: {
      enabled: isReady && !!address && !!sofAddress,
    },
  });

  return {
    balance: data ?? BigInt(0),
    isLoading,
    refetch,
  };
}

export default useSOFBalance;
