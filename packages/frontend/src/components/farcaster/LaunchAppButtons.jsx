// src/components/farcaster/LaunchAppButtons.jsx
import PropTypes from "prop-types";
import { useSupportsBaseApp } from "@/hooks/useIsMobile";
import { useFarcasterSDK } from "@/hooks/useFarcasterSDK";
import { Button } from "@/components/ui/button";

/**
 * LaunchAppButtons - Buttons to launch the MiniApp in Farcaster or Base App
 * - Desktop: Shows only Farcaster button
 * - Mobile/Tablet: Shows both Farcaster and Base App buttons
 * - Hidden when already inside a Farcaster client (Farcaster or Base App)
 */
const LaunchAppButtons = ({ domain = "secondorder.fun" }) => {
  const showBaseApp = useSupportsBaseApp();
  const { isInFarcasterClient } = useFarcasterSDK();

  // Don't show launch buttons if already inside a Farcaster client
  if (isInFarcasterClient) {
    return null;
  }

  const farcasterUrl = `https://farcaster.xyz/~/mini-apps/launch?domain=${domain}`;
  const baseAppUrl = `https://base.app/app/${domain}`;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
      {/* Farcaster Button - Always visible */}
      <a
        href={farcasterUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button variant="farcaster" className="w-[220px] px-6 py-3 rounded-lg font-semibold whitespace-nowrap gap-2">
          {/* Farcaster Icon */}
          <svg viewBox="0 0 1000 1000" className="w-5 h-5 shrink-0" fill="currentColor">
            <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
            <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
            <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
          </svg>
          <span>Open in Farcaster</span>
        </Button>
      </a>

      {/* Base App Button - Visible on mobile phones and tablets */}
      {showBaseApp && (
        <a
          href={baseAppUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="base" className="w-[220px] px-6 py-3 rounded-lg font-semibold whitespace-nowrap gap-1.5">
            <span>Open in</span>
            {/* Base Lockup - Official SVG from base.org brand assets */}
            <svg
              viewBox="0 0 1280 323.84"
              className="h-3.5 w-[56px] shrink-0"
              fill="currentColor"
            >
              <path d="M447.23,323.58c-25.22,0-49.54-9.22-63.87-33.54h-8.32v26.62h-57.34V0h57.34v115.2h8.32c14.72-25.22,42.24-34.94,67.07-34.94,61.95,0,103.81,49.54,103.81,119.3s-45.95,123.9-107.01,123.9v.13ZM434.82,272.26c35.33,0,60.54-28.93,60.54-70.27s-25.73-70.27-60.54-70.27-59.65,27.52-59.65,70.27,25.22,70.27,59.65,70.27ZM660.22,323.58c-44.03,0-79.87-26.62-79.87-70.27s39.42-67.97,87.17-72.96l67.46-6.91v-12.8c0-19.71-16.13-33.54-44.54-33.54s-42.75,11.9-47.74,29.82h-55.04c5.5-43.65,41.73-76.67,102.78-76.67s97.79,28.42,97.79,83.97v112c0,14.21,1.41,33.92,2.3,39.42v.9h-55.04c-.51-7.81-.51-15.1-.51-22.91h-8.32c-14.21,22.91-39.04,29.82-66.56,29.82l.13.13ZM675.84,280.45c37.63,0,59.26-28.42,59.26-57.34v-11.52l-50.56,6.02c-31.23,3.71-46.34,12.8-46.34,33.02s15.62,29.82,37.63,29.82ZM926.08,323.58c-57.86,0-99.2-28.93-105.6-74.37h56.45c6.4,20.22,27.52,28.93,49.54,28.93s40.83-9.6,40.83-26.62-17.41-21.63-41.34-25.73l-24.32-4.1c-45.95-7.81-74.37-27.14-74.37-68.35s39.42-72.96,94.08-72.96,88.58,24.83,98.18,67.97h-55.04c-6.4-17.02-23.42-23.81-42.75-23.81s-38.53,10.11-38.53,24.32,11.9,19.33,36.74,23.42l24.32,4.1c44.54,7.3,78.46,25.73,78.46,70.27s-40.45,77.18-96.9,77.18l.26-.26ZM1166.59,323.58c-70.66,0-117.5-48.26-117.5-122.11s49.54-121.22,118.02-121.22,112.9,53.25,112.9,123.52v10.11h-174.85c2.82,38.14,29.44,60.54,61.57,60.54s42.75-9.22,50.56-25.22h58.75c-11.9,43.14-54.66,74.37-109.31,74.37h-.13ZM1223.94,175.87c-4.61-30.72-28.93-48.64-57.34-48.64s-55.04,17.41-60.54,48.64h118.02-.13Z" />
              <path d="M13.82,316.8c-9.22,0-13.82-4.61-13.82-13.82V100.99c0-9.22,4.61-13.82,13.82-13.82h201.98c9.22,0,13.82,4.61,13.82,13.82v201.98c0,9.22-4.61,13.82-13.82,13.82H13.82Z" />
            </svg>
          </Button>
        </a>
      )}
    </div>
  );
};

LaunchAppButtons.propTypes = {
  domain: PropTypes.string,
};

export default LaunchAppButtons;
