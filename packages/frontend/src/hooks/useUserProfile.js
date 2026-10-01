/**
 * User Profile Hook
 * Profile of the connected wallet: the app username (UsernameContext) as the
 * display name, falling back to the ENS name; the ENS avatar as the picture.
 */

import { useAccount, useEnsAvatar, useEnsName } from "wagmi";
import { normalize } from "viem/ens";
import { useUsernameContext } from "@/context/UsernameContext";

export const useUserProfile = () => {
  const { address, isConnected } = useAccount();
  const { username } = useUsernameContext();

  const { data: ensName } = useEnsName({
    address,
    enabled: isConnected,
  });

  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    enabled: !!ensName,
  });

  if (!isConnected) {
    return {
      pfpUrl: null,
      displayName: null,
      username: null,
      address: null,
    };
  }

  const name = username || ensName || null;
  return {
    pfpUrl: ensAvatar || null,
    displayName: name,
    username: name,
    address,
  };
};

export default useUserProfile;
