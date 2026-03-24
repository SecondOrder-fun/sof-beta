import { useRef, useCallback, useState, useEffect } from "react";
import { useSignIn } from "@farcaster/auth-kit";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "react-i18next";

const SIWF_TIMEOUT_MS = 300_000; // 5 minutes
const SIWF_POLL_INTERVAL_MS = 1_500; // 1.5 seconds
const RELAY_URL = "https://relay.farcaster.xyz/v1/channel/status";

/**
 * SIWF (Sign In With Farcaster) hook.
 *
 * Uses auth-kit's useSignIn for channel creation only, then manually polls
 * the Farcaster relay via a Promise-based approach. This avoids auth-kit's
 * internal watchStatus effect which re-triggers on dependency changes and
 * polls consumed channels (causing 401 floods).
 *
 * @param {object} [opts]
 * @param {() => void} [opts.onSuccess] - called after successful backend verification
 * @param {() => void} [opts.onError]   - called on sign-in error
 */
export const useFarcasterSignIn = ({ onSuccess, onError } = {}) => {
  const { t } = useTranslation("auth");
  const { fetchNonce, verifyWithBackend, isVerifying } = useFarcaster();
  const { toast } = useToast();

  const [isConnecting, setIsConnecting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [showQrView, setShowQrView] = useState(false);
  const [url, setUrl] = useState(null);

  const nonceRef = useRef(null);
  const abortRef = useRef(null);
  const pollingTokenRef = useRef(null);

  // Refs for callbacks to avoid stale closures in the polling Promise chain
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const nonceGetter = useCallback(async () => {
    const nonce = await fetchNonce();
    nonceRef.current = nonce;
    return nonce;
  }, [fetchNonce]);

  const {
    signOut,
    connect,
    reconnect,
    channelToken,
    url: authKitUrl,
    isError,
  } = useSignIn({
    nonce: nonceGetter,
    timeout: SIWF_TIMEOUT_MS,
    interval: SIWF_POLL_INTERVAL_MS,
  });

  /**
   * Poll relay until the user confirms in Farcaster.
   * Returns a Promise that resolves with the signed message data,
   * or null if aborted.
   */
  const pollRelay = useCallback((token) => {
    // Abort any in-flight poll first
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    return new Promise((resolve, reject) => {
      const deadline = Date.now() + SIWF_TIMEOUT_MS;

      const tick = () => {
        if (controller.signal.aborted) return resolve(null);
        if (Date.now() > deadline) return reject(new Error("Sign-in timed out"));

        fetch(RELAY_URL, {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          signal: controller.signal,
        })
          .then((res) => {
            if (res.status === 401) throw new Error("Channel expired or unauthorized");
            if (!res.ok) throw new Error(`Relay returned ${res.status}`);
            return res.json();
          })
          .then((data) => {
            if (data.state === "completed" && data.message && data.signature) {
              resolve(data);
            } else {
              setTimeout(tick, SIWF_POLL_INTERVAL_MS);
            }
          })
          .catch((err) => {
            if (err.name === "AbortError") resolve(null);
            else reject(err);
          });
      };

      tick();
    });
  }, []);

  const handleSignInClick = useCallback(() => {
    if (isConnecting || isPolling) return; // guard against double-click
    setIsConnecting(true);
    if (isError) {
      reconnect();
    } else {
      connect();
    }
  }, [connect, reconnect, isError, isConnecting, isPolling]);

  // When channelToken arrives from connect(), start manual polling.
  // useEffect ensures proper cleanup on unmount and avoids render-body side effects.
  useEffect(() => {
    // Only start polling when a NEW channelToken arrives.
    // pollingTokenRef guards against double-polling; no need for isConnecting
    // in the dep array (which would cause cleanup to abort the poll immediately).
    if (!channelToken || pollingTokenRef.current === channelToken) return;

    pollingTokenRef.current = channelToken;
    setIsConnecting(false);
    setIsPolling(true);
    setShowQrView(true);
    setUrl(authKitUrl || null);

    pollRelay(channelToken)
      .then(async (data) => {
        if (!data) return; // aborted

        const { message, signature } = data;
        const nonce = nonceRef.current;

        if (!message || !signature || !nonce) {
          toast({
            title: t("siwfError", "Authentication Error"),
            description: "Missing SIWF response data",
            variant: "destructive",
          });
          return;
        }

        const { user } = await verifyWithBackend({ message, signature, nonce });
        toast({
          title: t("siwfSuccess", "Signed In"),
          description: `${t("welcome", "Welcome")}, ${user.displayName || user.username || `FID ${user.fid}`}!`,
        });
        onSuccessRef.current?.();
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        toast({
          title: t("siwfError", "Authentication Error"),
          description: err.message || "Sign in failed",
          variant: "destructive",
        });
        onErrorRef.current?.();
      })
      .finally(() => {
        setIsPolling(false);
        setShowQrView(false);
        pollingTokenRef.current = null;
      });

    // Cleanup: abort polling on unmount or if channelToken changes
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelToken]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    signOut();
    setShowQrView(false);
    setIsConnecting(false);
    setIsPolling(false);
    pollingTokenRef.current = null;
  }, [signOut]);

  const isLoading = isVerifying || (isConnecting && !isPolling);

  return {
    handleSignInClick,
    handleCancel,
    signOut,
    isConnecting,
    isPolling,
    showQrView,
    url,
    isLoading,
  };
};
