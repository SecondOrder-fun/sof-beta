// src/hooks/useAccessControl.js
// Access control helpers for role-gated UI. Uses viem read client (no wallet).

import { useMemo } from "react";
import { getAddress } from "viem";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddresses, RAFFLE_ABI } from "@/config/contracts";
import { buildPublicClient } from "@/lib/viemClient";

/**
 * Roles can be provided as hex or computed in app. Placeholder until ABI wired.
 */
export function useAccessControl() {
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const addr = getContractAddresses(netKey);

  const client = useMemo(() => {
    return buildPublicClient(netKey);
  }, [netKey]);

  /**
   * Check if `account` has `role` on the raffle contract.
   * Currently returns false until ABI + function are wired.
   */
  async function hasRole(roleHex, account) {
    try {
      // If no RPC client (e.g., TESTNET rpc unset), default to false to keep UI stable
      if (!client) return false;
      if (!addr.RAFFLE) return false;
      const normalized = getAddress(account);
      const has = await client.readContract({
        address: addr.RAFFLE,
        abi: RAFFLE_ABI,
        functionName: "hasRole",
        args: [roleHex, normalized],
      });
      return Boolean(has);
    } catch {
      // Fallback: on LOCAL network, treat default Anvil deployer as admin
      try {
        const anvilDeployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        if (
          String(net.name || "")
            .toLowerCase()
            .includes("anvil") ||
          net.id === 31337
        ) {
          return getAddress(account) === getAddress(anvilDeployer);
        }
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  return { hasRole };
}
