// src/hooks/useIsMobile.js
import { useState, useEffect } from "react";

/**
 * Hook to detect if the user is on a mobile device
 * Uses media query for responsive detection
 */
const useIsMobile = (breakpoint = 768) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check if window is available (SSR safety)
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);

    // Set initial value
    setIsMobile(mediaQuery.matches);

    // Handler for media query changes
    const handleChange = (event) => {
      setIsMobile(event.matches);
    };

    // Add listener
    mediaQuery.addEventListener("change", handleChange);

    // Cleanup
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [breakpoint]);

  return isMobile;
};

/**
 * Hook to detect if the device supports Base App
 * Returns true for mobile phones and tablets (touch devices up to iPad size)
 * iPad Air: 820x1180, iPad Pro 12.9": 1024x1366
 */
export const useSupportsBaseApp = () => {
  const [supportsBaseApp, setSupportsBaseApp] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkSupport = () => {
      // Check for touch capability
      const hasTouch =
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches;

      // Check if it's a mobile/tablet platform (not desktop with touchscreen)
      const isMobileOrTablet =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        ) ||
        // iPad on iOS 13+ reports as Mac, so check for touch + Mac
        (navigator.userAgent.includes("Mac") && hasTouch);

      // Also check screen size - tablets up to ~1024px width in portrait
      const isTabletSize = window.innerWidth <= 1024;

      setSupportsBaseApp(hasTouch && isMobileOrTablet && isTabletSize);
    };

    checkSupport();

    // Re-check on resize (for orientation changes)
    window.addEventListener("resize", checkSupport);

    return () => {
      window.removeEventListener("resize", checkSupport);
    };
  }, []);

  return supportsBaseApp;
};

export default useIsMobile;
