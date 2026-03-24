/**
 * Platform Detection Hook
 * Detects whether the app is running in:
 * - Web (desktop/mobile browser)
 * - Farcaster Mini App
 * - Base App (dApp browser)
 */

import { useState, useEffect, useSyncExternalStore } from "react";
import { useFarcasterSDK } from "./useFarcasterSDK";
import { useSupportsBaseApp } from "./useIsMobile";

const mobileMQ =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 768px)")
    : null;

function subscribeMobileMQ(cb) {
  mobileMQ?.addEventListener("change", cb);
  return () => mobileMQ?.removeEventListener("change", cb);
}

function getSnapshotMobileMQ() {
  return mobileMQ?.matches ?? false;
}

function getServerSnapshotMobileMQ() {
  return false;
}

export const PLATFORMS = {
  WEB: "web",
  FARCASTER: "farcaster",
  BASE_APP: "base_app",
};

export const usePlatform = () => {
  const { isInFarcasterClient, isSDKLoaded } = useFarcasterSDK();
  const supportsBaseApp = useSupportsBaseApp();
  const [platform, setPlatform] = useState(PLATFORMS.WEB);
  const isNarrowViewport = useSyncExternalStore(
    subscribeMobileMQ,
    getSnapshotMobileMQ,
    getServerSnapshotMobileMQ,
  );

  useEffect(() => {
    if (!isSDKLoaded) return;

    // Priority: Farcaster > Base App > Web
    if (isInFarcasterClient) {
      setPlatform(PLATFORMS.FARCASTER);
    } else if (supportsBaseApp) {
      // Check if we're in a dApp browser
      const isInDappBrowser =
        typeof window !== "undefined" &&
        (window.ethereum !== undefined || window.coinbaseWallet !== undefined);

      if (isInDappBrowser) {
        setPlatform(PLATFORMS.BASE_APP);
      } else {
        setPlatform(PLATFORMS.WEB);
      }
    } else {
      setPlatform(PLATFORMS.WEB);
    }
  }, [isInFarcasterClient, isSDKLoaded, supportsBaseApp]);

  const isWeb = platform === PLATFORMS.WEB;

  return {
    platform,
    isWeb,
    isFarcaster: platform === PLATFORMS.FARCASTER,
    isBaseApp: platform === PLATFORMS.BASE_APP,
    isMobile:
      platform === PLATFORMS.FARCASTER || platform === PLATFORMS.BASE_APP,
    isMobileBrowser: isWeb && isNarrowViewport,
  };
};

export default usePlatform;
