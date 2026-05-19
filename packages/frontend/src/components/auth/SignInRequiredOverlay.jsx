/**
 * SignInRequiredOverlay
 *
 * Absolute-positioned card that covers a transaction surface (Buy/Sell,
 * Claims, Rollover, Sponsor, Treasury) when the user is connected but
 * AppAuth status landed on 'rejected' or 'error' — i.e. auto-fire SIWE
 * was denied or failed and the user needs a manual retry.
 *
 * Mounts inside a `relative` parent. Returns null in every other auth
 * state so the surface renders normally for authenticated users and
 * during the brief auto-fire signing window.
 *
 * Mirrors TradingStatusOverlay's variant/rounding contract.
 */

import { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { AppAuthContext } from "@/context/AppAuthContext";

export const SignInRequiredOverlay = ({ variant = "desktop" }) => {
  const { t } = useTranslation("auth");
  // Read context directly (not via useAppAuth) so the overlay renders as a
  // no-op outside an AppAuthProvider — keeps host-component tests from
  // having to wire up an auth provider just to mount a transaction surface.
  const ctx = useContext(AppAuthContext);
  if (!ctx) return null;
  const { status, error, signIn } = ctx;

  if (status !== "rejected" && status !== "error") return null;

  const isRejected = status === "rejected";
  const title = isRejected
    ? t("signInRetry.rejectedTitle")
    : t("signInRetry.errorTitle");
  const body = isRejected
    ? t("signInRetry.rejectedBody")
    : t("signInRetry.errorBody", { reason: error || "Unknown error" });

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
          className="mt-4 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          {t("signInRetry.button")}
        </button>
      </div>
    </div>
  );
};

SignInRequiredOverlay.propTypes = {
  variant: PropTypes.oneOf(["desktop", "mobile"]),
};

export default SignInRequiredOverlay;
