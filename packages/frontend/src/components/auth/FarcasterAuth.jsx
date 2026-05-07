import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useFarcasterSignIn } from "@/hooks/useFarcasterSignIn";
import { Button } from "@/components/ui/button";
import { QrFrame } from "@/components/ui/qr-frame";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, X } from "lucide-react";

const FarcasterAuth = () => {
  const { t } = useTranslation("auth");
  const { profile } = useFarcaster();
  const {
    user: appAuthUser,
    status: authStatus,
    signOut: appAuthSignOut,
  } = useAppAuth();

  const isBackendAuthenticated = authStatus === "authenticated";
  const username = appAuthUser?.username || null;
  const fid = appAuthUser?.fid || null;
  const displayName = profile?.displayName || null;
  const pfpUrl = profile?.pfpUrl || null;

  const {
    handleSignInClick,
    handleCancel,
    signOut,
    showQrView,
    url,
    isLoading,
  } = useFarcasterSignIn();

  // Authenticated state — show profile + sign-out
  if (isBackendAuthenticated && appAuthUser) {
    return (
      <div className="flex items-center gap-3">
        {pfpUrl && (
          <img
            src={pfpUrl}
            alt={displayName || username || ""}
            className="w-8 h-8 rounded-full"
          />
        )}
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {displayName || username || (fid ? `FID ${fid}` : "")}
          </span>
          {username && (
            <span className="text-xs text-muted-foreground">
              @{username}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            signOut();
            appAuthSignOut();
          }}
        >
          {t("farcasterSignOut", "Sign Out")}
        </Button>
      </div>
    );
  }

  // Button label depends on state
  const buttonLabel = t("signInWithFarcaster", "Sign in with Farcaster");

  return (
    <>
      <Button
        variant="farcaster"
        onClick={handleSignInClick}
        disabled={isLoading}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {buttonLabel}
      </Button>

      <Dialog open={showQrView} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="bg-background border border-primary max-w-sm">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {t("signInWithFarcaster", "Log in with Farcaster")}
              </DialogTitle>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={handleCancel}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            {url ? (
              <>
                <QrFrame>
                  <QRCodeSVG value={url} size={220} level="L" />
                </QrFrame>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline"
                >
                  {t("openInFarcaster", "Open in Farcaster")}
                </a>
              </>
            ) : (
              <div className="flex items-center justify-center h-[220px] w-[220px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          <DialogDescription className="text-center">
            {t(
              "scanQrCodeDescription",
              "Scan this QR code with the camera on a smartphone that has Farcaster installed and logged in with the account you want to use.",
            )}
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default FarcasterAuth;
