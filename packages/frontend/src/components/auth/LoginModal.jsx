import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConnect, useAccount } from "wagmi";
import { useLoginModal } from "@/hooks/useLoginModal";
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

  // Auto-close when wallet connects
  useEffect(() => {
    if (isConnected && isLoginModalOpen) {
      closeLoginModal();
    }
  }, [isConnected, isLoginModalOpen, closeLoginModal]);

  const handleOpenChange = (open) => {
    if (!open) closeLoginModal();
  };

  // Filter the Farcaster MiniApp connector (auto-connects in MiniApp context;
  // never relevant in a browser sign-in list) and dedupe by id. RainbowKit
  // emits multiple WalletConnect-backed connectors (rainbowWallet,
  // walletConnectWallet, ...) all sharing id="walletConnect"; without dedupe
  // they render as 2-3 indistinct "WalletConnect" rows with no icons.
  const walletConnectors = (() => {
    const seen = new Set();
    return connectors.filter((c) => {
      if (c.id === "farcasterFrame" || c.type === "farcasterFrame") return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  return (
    <Dialog open={isLoginModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-background border border-primary max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("logInOrSignUp", "Log in or sign up")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("logInOrSignUp", "Log in or sign up")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            {walletConnectors.map((connector) => (
              <Button
                key={connector.uid}
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => connect({ connector })}
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
      </DialogContent>
    </Dialog>
  );
};

export default LoginModal;
