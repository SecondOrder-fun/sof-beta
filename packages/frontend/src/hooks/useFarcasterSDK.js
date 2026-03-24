/**
 * Farcaster Mini App SDK Hook
 * Initializes the SDK and calls ready() to hide the splash screen
 * Should be used at the app root level
 */

import { useState, useEffect } from "react";

export const useFarcasterSDK = () => {
  const [sdk, setSdk] = useState(null);
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [isInFarcasterClient, setIsInFarcasterClient] = useState(false);
  const [context, setContext] = useState(null);

  useEffect(() => {
    const initSDK = async () => {
      try {
        // Dynamically import the SDK
        const miniappSdk = await import("@farcaster/miniapp-sdk");
        const sdkInstance = miniappSdk.sdk;
        setSdk(sdkInstance);

        // Get context to check if we're in a Farcaster client
        const ctx = await sdkInstance.context;

        if (ctx) {
          setContext(ctx);
          setIsInFarcasterClient(true);

          // IMPORTANT: Call ready() to hide the splash screen
          await sdkInstance.actions.ready();
        }

        setIsSDKLoaded(true);
      } catch (err) {
        // SDK not available or not in Farcaster client - this is expected on web
        setIsSDKLoaded(true);
        setIsInFarcasterClient(false);
      }
    };

    initSDK();
  }, []);

  return {
    sdk,
    isSDKLoaded,
    isInFarcasterClient,
    context,
  };
};

export default useFarcasterSDK;
