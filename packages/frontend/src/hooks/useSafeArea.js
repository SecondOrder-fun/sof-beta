/**
 * Safe Area Hook
 * Provides safe area insets for mobile devices (notches, home indicators, etc.)
 * Uses CSS env() variables with fallbacks
 */

import { useState, useEffect } from "react";

export const useSafeArea = () => {
  const [safeArea, setSafeArea] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateSafeArea = () => {
      // Try to get CSS env() values
      const computedStyle = getComputedStyle(document.documentElement);

      const top = parseInt(
        computedStyle.getPropertyValue("--safe-area-inset-top") || "0"
      );
      const right = parseInt(
        computedStyle.getPropertyValue("--safe-area-inset-right") || "0"
      );
      const bottom = parseInt(
        computedStyle.getPropertyValue("--safe-area-inset-bottom") || "0"
      );
      const left = parseInt(
        computedStyle.getPropertyValue("--safe-area-inset-left") || "0"
      );

      setSafeArea({ top, right, bottom, left });
    };

    // Set CSS variables from env()
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --safe-area-inset-top: env(safe-area-inset-top, 0px);
        --safe-area-inset-right: env(safe-area-inset-right, 0px);
        --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
        --safe-area-inset-left: env(safe-area-inset-left, 0px);
      }
    `;
    document.head.appendChild(style);

    updateSafeArea();

    // Update on resize/orientation change
    window.addEventListener("resize", updateSafeArea);
    window.addEventListener("orientationchange", updateSafeArea);

    return () => {
      window.removeEventListener("resize", updateSafeArea);
      window.removeEventListener("orientationchange", updateSafeArea);
      document.head.removeChild(style);
    };
  }, []);

  return safeArea;
};

export default useSafeArea;
