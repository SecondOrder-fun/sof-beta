/**
 * Platform Detection Hook
 *
 * `isMobile` decides the layout: phones and touch tablets get the mobile
 * interface (MobileHeader, BottomNav and the per-route components in
 * components/mobile), every other screen gets the desktop one. It is a pure
 * media query (MOBILE_LAYOUT_QUERY) read synchronously through
 * useSyncExternalStore, so the first render already has the right layout (no
 * desktop-to-mobile flash) and nothing waits on the Farcaster SDK.
 *
 * `platform` / `isWeb` / `isFarcaster` / `isBaseApp` still report whether the
 * app runs in a browser, the Farcaster Mini App or a Base App dApp browser.
 * They do not influence the layout and go away with the Farcaster integration.
 */

import { useState, useEffect, useSyncExternalStore } from "react";
import { useFarcasterSDK } from "./useFarcasterSDK";
import { useSupportsBaseApp } from "./useIsMobile";

/** Phones (up to 768px wide) and touch tablets up to 1024px (iPad portrait). */
export const MOBILE_LAYOUT_QUERY =
  "(max-width: 768px), (pointer: coarse) and (max-width: 1024px)";

// The MediaQueryList is created on first use rather than at module load, and
// recreated if window.matchMedia is swapped (tests stub it per case).
let cachedMatchMedia = null;
let cachedMQ = null;

function getMobileMQ() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  if (cachedMatchMedia !== window.matchMedia) {
    cachedMatchMedia = window.matchMedia;
    cachedMQ = window.matchMedia(MOBILE_LAYOUT_QUERY);
  }
  return cachedMQ;
}

function subscribeMobileMQ(cb) {
  const mq = getMobileMQ();
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}

function getSnapshotMobileMQ() {
  return getMobileMQ()?.matches ?? false;
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
  const isMobile = useSyncExternalStore(
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

  return {
    platform,
    isWeb: platform === PLATFORMS.WEB,
    isFarcaster: platform === PLATFORMS.FARCASTER,
    isBaseApp: platform === PLATFORMS.BASE_APP,
    isMobile,
  };
};

export default usePlatform;
