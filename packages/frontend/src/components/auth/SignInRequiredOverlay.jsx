/**
 * SignInRequiredOverlay
 *
 * Absolute-positioned card that covers a transaction surface (Buy/Sell,
 * InfoFi markets, Claims, Sponsor, Treasury) whenever the user has a
 * wallet connected but AppAuth hasn't reached 'authenticated' yet —
 * i.e. auto-fire SIWE was rejected, errored, never ran, or is in
 * flight. Stays up until sign-in succeeds.
 *
 * Mounts inside a `relative` parent. Renders null when:
 *   - no AppAuthContext is present (lightweight host-component tests)
 *   - no wallet address is connected (the surface's own
 *     walletNotConnected guard handles that case)
 *   - status is 'authenticated'
 *
 * Button label tracks status:
 *   idle              → "Sign in" (active)
 *   signing/verifying → "Signing in…" (disabled)
 *   rejected/error    → "Try again" (active)
 *
 * Mirrors TradingStatusOverlay's variant/rounding contract.
 */

import { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { AppAuthContext } from "@/context/AppAuthContext";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";

export const SignInRequiredOverlay = ({ variant = "desktop" }) => {
  const { t } = useTranslation("auth");
  const ctx = useContext(AppAuthContext);
  // Gate on walletStatus === 'connected', not just `address`: during wagmi's
  // 'reconnecting' hydration window `address` is already truthy but the
  // connector is still dehydrated, and calling signMessage in that window
  // throws "connection.connector.getChainId is not a function" — the same
  // failure mode AppAuthProvider's auto-fire effect guards against.
  const { address, status: walletStatus } = useAccount();
  const { walletType } = useRaffleAccount();

  if (!ctx) return null;
  if (!address || walletStatus !== "connected") return null;
  // Farcaster MiniApp users auto-sign-in via the WagmiConfigProvider
  // FarcasterAutoConnect + AppAuthProvider.signIn({ method: 'farcaster' })
  // path. Routing them through this overlay would call signIn() with the
  // default method:'wallet' and send raw SIWE through the Farcaster
  // connector, bypassing the intended SIWF flow. Mirrors AppAuthProvider's
  // AUTO_FIRE_WALLET_TYPES exclusion.
  if (walletType === "farcaster-miniapp") return null;

  const { status, error, signIn } = ctx;
  if (status === "authenticated") return null;

  const isRejected = status === "rejected";
  const isError = status === "error";
  const isInFlight = status === "signing" || status === "verifying";

  let title;
  let body;
  let buttonLabel;
  if (isRejected) {
    title = t("signInRetry.rejectedTitle");
    body = t("signInRetry.rejectedBody");
    buttonLabel = t("signInRetry.button");
  } else if (isError) {
    title = t("signInRetry.errorTitle");
    body = t("signInRetry.errorBody", { reason: error || "Unknown error" });
    buttonLabel = t("signInRetry.button");
  } else {
    title = t("signInRequired.title");
    body = t("signInRequired.body");
    buttonLabel = isInFlight
      ? t("signInRequired.signingButton")
      : t("signInRequired.button");
  }

  const baseClasses =
    "absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm";
  const roundedClasses = variant === "mobile" ? "rounded-t-2xl" : "rounded-lg";

  return (
    <div
      className={`${baseClasses} ${roundedClasses}`}
      data-testid="signin-required-overlay"
    >
      <div className="max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-lg">
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        <button
          type="button"
          onClick={() => signIn()}
          disabled={isInFlight}
          className="mt-4 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
};

SignInRequiredOverlay.propTypes = {
  variant: PropTypes.oneOf(["desktop", "mobile"]),
};

export default SignInRequiredOverlay;
