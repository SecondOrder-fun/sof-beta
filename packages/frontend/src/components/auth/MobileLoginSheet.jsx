import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConnect, useAccount } from "wagmi";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, ArrowLeft } from "lucide-react";
import { useLoginModal } from "@/hooks/useLoginModal";
import { useFarcasterSignIn } from "@/hooks/useFarcasterSignIn";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const MobileLoginSheet = () => {
  const { t } = useTranslation("auth");
  const { isLoginModalOpen, closeLoginModal } = useLoginModal();
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();

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

  // Reset to options view and cancel stale SIWF state when sheet opens
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

  const walletConnectors = connectors.filter(
    (c) => c.id !== "farcasterFrame" && c.type !== "farcasterFrame",
  );

  return (
    <Sheet open={isLoginModalOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="px-6 pb-8">
        {view === "options" ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("logInOrSignUp", "Log in or sign up")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("logInOrSignUp", "Log in or sign up")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 py-2">
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

              <div className="relative flex items-center">
                <div className="flex-1 border-t border-border" />
                <span className="mx-3 text-xs text-muted-foreground">
                  {t("orConnectWallet", "or connect a wallet")}
                </span>
                <div className="flex-1 border-t border-border" />
              </div>

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
            <SheetHeader>
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
                <SheetTitle>
                  {t("signInWithFarcaster", "Sign in with Farcaster")}
                </SheetTitle>
              </div>
              <SheetDescription className="sr-only">
                {t("scanQrCodeDescription")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              {url ? (
                <>
                  <div className="rounded-lg overflow-hidden bg-white p-3">
                    <QRCodeSVG value={url} size={200} level="L" />
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
                <div className="flex items-center justify-center h-[200px] w-[200px]">
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
      </SheetContent>
    </Sheet>
  );
};

export default MobileLoginSheet;
