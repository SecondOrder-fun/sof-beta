// src/components/auth/SignInRetryBanner.jsx
//
// Shown when AppAuthProvider's status is 'rejected' or 'error'. Lets the user
// retry the SIWE flow without disconnecting. Hidden in all other states so
// the dapp doesn't flash a banner during signing/verifying.
//
// Mounts in <App /> next to <FirstConnectBanner /> in both desktop and mobile
// branches.

import { useTranslation } from "react-i18next";
import { useAppAuth } from "@/hooks/useAppAuth";

const SignInRetryBanner = () => {
  const { t } = useTranslation("auth");
  const { status, error, signIn } = useAppAuth();

  if (status !== "rejected" && status !== "error") return null;

  const isRejected = status === "rejected";
  const title = isRejected
    ? t("signInRetry.rejectedTitle")
    : t("signInRetry.errorTitle");
  const body = isRejected
    ? t("signInRetry.rejectedBody")
    : t("signInRetry.errorBody", { reason: error || "Unknown error" });

  const tone = isRejected
    ? "border-destructive/40 bg-destructive/10"
    : "border-warning/40 bg-warning/10";

  return (
    <div
      role="status"
      data-testid="signin-retry-banner"
      className="container mx-auto mt-4 px-4"
    >
      <div className={`rounded-md border p-4 text-foreground ${tone}`}>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => signIn()}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            {t("signInRetry.button")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignInRetryBanner;
