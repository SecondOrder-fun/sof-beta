/**
 * Platform Detection Hook
 *
 * `isMobile` decides the layout: phones and touch tablets get the mobile
 * interface (MobileHeader, BottomNav and the per-route components in
 * components/mobile), every other screen gets the desktop one. It is a pure
 * media query (MOBILE_LAYOUT_QUERY) read synchronously through
 * useSyncExternalStore, so the first render already has the right layout (no
 * desktop-to-mobile flash).
 */

import { useSyncExternalStore } from "react";

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

export const usePlatform = () => {
  const isMobile = useSyncExternalStore(
    subscribeMobileMQ,
    getSnapshotMobileMQ,
    getServerSnapshotMobileMQ,
  );

  return { isMobile };
};

export default usePlatform;
