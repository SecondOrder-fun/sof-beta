import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConnect, useAccount } from "wagmi";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, ArrowLeft } from "lucide-react";
import { useLoginModal } from "@/hooks/useLoginModal";
import { useFarcasterSignIn } from "@/hooks/useFarcasterSignIn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const LoginModal = () => {
  const { t } = useTranslation("auth");
  const { isLoginModalOpen, closeLoginModal } = useLoginModal();
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();

  // Internal view: 'options' | 'farcaster-qr'
  const [view, setView] = useState("options");

  const handleSiwfSuccess = useCallback(() => {
    closeLoginModal();
  }, [closeLoginModal]);

  const {
    handleSignInClick,
    handleCancel: cancelSiwf,
    url,
    isLoading: isSiwfLoading,
  } = useFarcasterSignIn({ onSuccess: handleSiwfSuccess });

  // Auto-close when wallet connects
  useEffect(() => {
    if (isConnected && isLoginModalOpen) {
      closeLoginModal();
    }
  }, [isConnected, isLoginModalOpen, closeLoginModal]);

  // Reset to options view and cancel stale SIWF state when modal opens
  useEffect(() => {
    if (isLoginModalOpen) {
      cancelSiwf();
      setView("options");
    }
  }, [isLoginModalOpen, cancelSiwf]);

  const handleOpenChange = useCallback(
    (open) => {
      if (!open) {
        cancelSiwf();
        closeLoginModal();
      }
    },
    [cancelSiwf, closeLoginModal],
  );

  const handleFarcasterClick = () => {
    setView("farcaster-qr");
    handleSignInClick();
  };

  const handleWalletClick = (connector) => {
    connect({ connector });
  };

  const handleBack = () => {
    cancelSiwf();
    setView("options");
  };

  // Filter out Farcaster mini-app connector from wallet list
  const walletConnectors = connectors.filter(
    (c) => c.id !== "farcasterFrame" && c.type !== "farcasterFrame",
  );

  return (
    <Dialog open={isLoginModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-background border border-primary max-w-sm">
        {view === "options" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("logInOrSignUp", "Log in or sign up")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("logInOrSignUp", "Log in or sign up")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2">
              {/* Farcaster primary CTA */}
              <Button
                variant="farcaster"
                className="w-full"
                onClick={handleFarcasterClick}
                disabled={isSiwfLoading}
              >
                {isSiwfLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("signInWithFarcaster", "Sign in with Farcaster")}
              </Button>

              {/* Separator */}
              <div className="relative flex items-center">
                <div className="flex-1 border-t border-border" />
                <span className="mx-3 text-xs text-muted-foreground">
                  {t("orConnectWallet", "or connect a wallet")}
                </span>
                <div className="flex-1 border-t border-border" />
              </div>

              {/* Wallet connectors */}
              <div className="flex flex-col gap-2">
                {walletConnectors.map((connector) => (
                  <Button
                    key={connector.uid}
                    variant="outline"
                    className="w-full justify-start gap-3"
                    onClick={() => handleWalletClick(connector)}
                  >
                    {connector.icon ? (
                      <img
                        src={connector.icon}
                        alt=""
                        className="h-5 w-5 rounded"
                      />
                    ) : (
                      <div className="h-5 w-5 rounded bg-muted" />
                    )}
                    {connector.name}
                  </Button>
                ))}
              </div>

              {/* Terms */}
              <p className="text-xs text-muted-foreground text-center pt-2">
                {t("termsAgreement", "By signing in you agree to our")}{" "}
                <a
                  href="https://docs.secondorder.fun/legal/terms-of-service"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-primary"
                >
                  Terms of Service
                </a>
                .
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Farcaster QR view */}
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">
                    {t("backToOptions", "Back")}
                  </span>
                </Button>
                <DialogTitle>
                  {t("signInWithFarcaster", "Sign in with Farcaster")}
                </DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                {t("scanQrCodeDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              {url ? (
                <>
                  <div className="rounded-lg overflow-hidden bg-white p-3">
                    <QRCodeSVG value={url} size={220} level="L" />
                  </div>
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

            <p className="text-sm text-muted-foreground text-center">
              {t(
                "scanQrCodeDescription",
                "Scan this QR code with the camera on a smartphone that has Farcaster installed and logged in with the account you want to use.",
              )}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LoginModal;
