/**
 * Farcaster Add Mini App Button
 * Only renders when running inside a Farcaster client (other clients)
 * Uses the Farcaster Frame SDK to prompt users to add the app
 */

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Button } from "@/components/ui/button";

const AddMiniAppButton = ({
  className = "",
  onAdded,
  onError,
  showNotificationStatus = true,
  hideWhenAdded = false,
  promptText = null,
  addedText = null,
}) => {
  const [sdk, setSdk] = useState(null);
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [isInFarcasterClient, setIsInFarcasterClient] = useState(false);
  const [isBaseApp, setIsBaseApp] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [hasNotifications, setHasNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load SDK and check if we're in a Farcaster client
  useEffect(() => {
    const loadSDK = async () => {
      try {
        // Dynamically import the SDK (correct package: @farcaster/miniapp-sdk)
        const miniappSdk = await import("@farcaster/miniapp-sdk");
        const sdkInstance = miniappSdk.sdk;
        setSdk(sdkInstance);

        // Check if we're in a Farcaster client by checking for context
        const context = await sdkInstance.context;

        if (context) {
          setIsInFarcasterClient(true);
          // Check if client is Base App (clientFid 309857) vs Farcaster (9152)
          const clientFid = context.client?.clientFid;
          if (clientFid === 309857) {
            setIsBaseApp(true);
          }
          // Check if app is already added (context.client.added)
          if (context.client?.added) {
            setIsAdded(true);
            // Check if notifications are enabled
            if (context.client?.notificationDetails) {
              setHasNotifications(true);
            }
          }
          // Signal that the app is ready
          sdkInstance.actions.ready();

          // Listen for miniapp removed event to show Add button again
          sdkInstance.on("miniappRemoved", () => {
            setIsAdded(false);
            setHasNotifications(false);
          });

          // Listen for notifications enabled/disabled events
          sdkInstance.on("notificationsEnabled", () => {
            setHasNotifications(true);
          });

          sdkInstance.on("notificationsDisabled", () => {
            setHasNotifications(false);
          });
        }

        setIsSDKLoaded(true);
      } catch (err) {
        // SDK not available or not in Farcaster client
        setIsSDKLoaded(true);
        setIsInFarcasterClient(false);
      }
    };

    loadSDK();
  }, []);

  // Base App workaround: re-check context when app becomes visible
  // Base App doesn't fire miniappRemoved SDK event, only sends webhook
  useEffect(() => {
    if (!sdk || !isBaseApp) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        try {
          const freshContext = await sdk.context;
          if (freshContext?.client) {
            setIsAdded(freshContext.client.added);
            setHasNotifications(!!freshContext.client.notificationDetails);
          }
        } catch {
          // Ignore errors during context refresh
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [sdk, isBaseApp]);

  // Farcaster client handler (working - don't change)
  const handleAddAppFarcaster = useCallback(async () => {
    if (!sdk || !isInFarcasterClient || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await sdk.actions.addMiniApp();

      // Handle case where result might be undefined/null (user dismissed)
      if (result === null || result === undefined) {
        setError("Cancelled");
        return;
      }

      // Check for explicit failure: { added: false, reason: string }
      if (result.added === false) {
        const reason = result.reason || "unknown";
        setError(`Failed: ${reason}`);
        onError?.(new Error(reason));
        return;
      }

      // Success: { added: true, notificationDetails?: {...} }
      setIsAdded(true);
      if (result.notificationDetails) {
        setHasNotifications(true);
      }
      onAdded?.(result);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add app";
      setError(errorMessage);
      onError?.(err);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, isInFarcasterClient, isLoading, onAdded, onError]);

  // Base App handler (per Base docs - different response format)
  const handleAddAppBase = useCallback(async () => {
    if (!sdk || !isInFarcasterClient || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await sdk.actions.addMiniApp();

      // Base App format per docs: response has notificationDetails if notifications enabled
      // Success is indicated by not throwing an error
      if (response?.notificationDetails) {
        setIsAdded(true);
        setHasNotifications(true);
        onAdded?.(response);
      } else {
        // Added without notifications
        setIsAdded(true);
        onAdded?.(response);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add app";
      setError(errorMessage);
      onError?.(err);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, isInFarcasterClient, isLoading, onAdded, onError]);

  // Use appropriate handler based on client
  const handleAddApp = isBaseApp ? handleAddAppBase : handleAddAppFarcaster;

  // Don't render if not in Farcaster client or SDK not loaded
  if (!isSDKLoaded || !isInFarcasterClient) {
    return null;
  }

  // Already added - hide completely or show confirmation
  if (isAdded) {
    if (hideWhenAdded && !addedText) {
      return null;
    }
    if (addedText) {
      return (
        <div className={className}>
          <p className="text-sm text-center text-muted-foreground">
            {addedText}
          </p>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-green-500">✓</span>
        <span className="text-sm text-muted-foreground">
          App Added
          {showNotificationStatus && hasNotifications && " • Notifications On"}
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      {promptText && (
        <p className="text-sm text-center mb-4 text-muted-foreground">
          {promptText}
        </p>
      )}
      <div className="flex justify-center">
        <Button
          onClick={handleAddApp}
          disabled={isLoading}
          variant="default"
          className="flex items-center gap-2"
        >
          {/* Farcaster icon - only show in Farcaster client, not Base App */}
          {!isBaseApp && (
            <svg
              viewBox="0 0 1000 1000"
              className="w-5 h-5"
              fill="currentColor"
            >
              <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
              <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
              <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
            </svg>
          )}
          <span>
            {isLoading
              ? "Adding..."
              : isBaseApp
              ? "Add Miniapp"
              : "Add to Farcaster"}
          </span>
          {error && <span className="text-red-400 text-xs ml-2">{error}</span>}
        </Button>
      </div>
    </div>
  );
};

AddMiniAppButton.propTypes = {
  className: PropTypes.string,
  onAdded: PropTypes.func,
  onError: PropTypes.func,
  showNotificationStatus: PropTypes.bool,
  hideWhenAdded: PropTypes.bool,
  promptText: PropTypes.string,
  addedText: PropTypes.string,
};

export default AddMiniAppButton;
