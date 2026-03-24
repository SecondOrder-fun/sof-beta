/**
 * User Profile Hook
 * Provides user profile data from Farcaster SDK or fallback sources
 * Returns profile image, display name, username, and FID
 */

import { useFarcasterSDK } from "./useFarcasterSDK";
import { useAccount, useEnsAvatar, useEnsName } from "wagmi";
import { normalize } from "viem/ens";

export const useUserProfile = () => {
  const { context, isInFarcasterClient } = useFarcasterSDK();
  const { address, isConnected } = useAccount();

  // ENS data as fallback
  const { data: ensName } = useEnsName({
    address,
    enabled: isConnected && !isInFarcasterClient,
  });

  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    enabled: !!ensName && !isInFarcasterClient,
  });

  // Farcaster profile (priority)
  if (isInFarcasterClient && context?.user) {
    return {
      pfpUrl: context.user.pfpUrl,
      displayName: context.user.displayName,
      username: context.user.username,
      fid: context.user.fid,
      address: context.user.verifiedAddresses?.[0] || address,
      source: "farcaster",
    };
  }

  // ENS profile (fallback)
  if (isConnected && (ensName || ensAvatar)) {
    return {
      pfpUrl: ensAvatar || null,
      displayName: ensName || null,
      username: ensName || null,
      fid: null,
      address,
      source: "ens",
    };
  }

  // Connected wallet (no profile data)
  if (isConnected) {
    return {
      pfpUrl: null,
      displayName: null,
      username: null,
      fid: null,
      address,
      source: "wallet",
    };
  }

  // Not connected
  return {
    pfpUrl: null,
    displayName: null,
    username: null,
    fid: null,
    address: null,
    source: null,
  };
};

export default useUserProfile;
