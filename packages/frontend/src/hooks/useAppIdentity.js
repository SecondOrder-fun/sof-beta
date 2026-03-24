/**
 * useAppIdentity Hook
 *
 * Resolves the best available user identity across:
 * - Farcaster/Base MiniApp context (MiniApp SDK)
 * - Desktop SIWF (Farcaster AuthKit)
 * - Wallet-only (wagmi)
 *
 * @returns {{
 *   fid: number|null,
 *   walletAddress: string|null,
 *   isMiniApp: boolean,
 *   clientFid: number|null,
 *   platformType: ("web"|"mobile"|null),
 *   isBaseApp: boolean,
 *   isFarcasterClient: boolean,
 *   identitySource: ("miniapp"|"authkit"|"wallet"|null)
 * }}
 */

import { useAccount } from "wagmi";
import useMiniAppSDK from "@/hooks/useFarcasterSDK";
import { useContext } from "react";
import FarcasterContext from "@/context/farcasterContext";

export const FARCASTER_CLIENT_FID = 9152;
export const BASE_APP_CLIENT_FID = 309857;

export function useAppIdentity() {
  const { address } = useAccount();
  const farcasterAuth = useContext(FarcasterContext);
  const isAuthenticated = Boolean(farcasterAuth?.isAuthenticated);
  const isBackendAuthenticated = Boolean(farcasterAuth?.isBackendAuthenticated);
  const profile = farcasterAuth?.profile ?? null;
  const backendUser = farcasterAuth?.backendUser ?? null;

  const { context: miniAppContext, isInFarcasterClient } = useMiniAppSDK();

  const miniAppFid = miniAppContext?.user?.fid ?? null;
  const authKitFid = isAuthenticated ? (profile?.fid ?? null) : null;
  // Fallback: backend-verified FID from our manual SIWF polling flow
  const backendFid = isBackendAuthenticated ? (backendUser?.fid ?? null) : null;

  const clientFid = miniAppContext?.client?.clientFid ?? null;
  const platformType = miniAppContext?.client?.platformType ?? null;

  const isMiniApp = Boolean(isInFarcasterClient && miniAppContext?.user);
  const isBaseApp = clientFid === BASE_APP_CLIENT_FID;
  const isFarcasterClient = clientFid === FARCASTER_CLIENT_FID;

  if (miniAppFid) {
    return {
      fid: miniAppFid,
      walletAddress: address ?? null,
      isMiniApp,
      clientFid,
      platformType,
      isBaseApp,
      isFarcasterClient,
      identitySource: "miniapp",
    };
  }

  if (authKitFid || backendFid) {
    return {
      fid: authKitFid || backendFid,
      walletAddress: address ?? null,
      isMiniApp,
      clientFid,
      platformType,
      isBaseApp,
      isFarcasterClient,
      identitySource: "authkit",
    };
  }

  if (address) {
    return {
      fid: null,
      walletAddress: address,
      isMiniApp,
      clientFid,
      platformType,
      isBaseApp,
      isFarcasterClient,
      identitySource: "wallet",
    };
  }

  return {
    fid: null,
    walletAddress: null,
    isMiniApp,
    clientFid,
    platformType,
    isBaseApp,
    isFarcasterClient,
    identitySource: null,
  };
}

export default useAppIdentity;
