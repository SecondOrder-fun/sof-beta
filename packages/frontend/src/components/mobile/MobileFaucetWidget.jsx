// src/components/mobile/MobileFaucetWidget.jsx
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useFaucet } from "@/hooks/useFaucet";

/**
 * MobileFaucetWidget - Simplified faucet for Farcaster/mobile UI
 * Branded as "Beta Phase Airdrop" with minimal UI
 */
const MobileFaucetWidget = () => {
  const { t } = useTranslation("common");
  const { isConnected } = useAccount();
  const {
    faucetData,
    isLoading,
    error,
    claim,
    getTimeRemaining,
    isClaimable,
  } = useFaucet();

  const [timeRemaining, setTimeRemaining] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    if (!faucetData) return;

    const updateTime = () => {
      setTimeRemaining(getTimeRemaining());
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [faucetData, getTimeRemaining]);

  const handleClaim = async () => {
    setTxHash("");
    try {
      const result = await claim();
      if (result?.hash) {
        setTxHash(result.hash);
      }
    } catch {
      // Error handled by hook
    }
  };

  const getExplorerUrl = (hash) => {
    if (!hash) return "#";
    const baseUrl =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
        ? "#"
        : "https://sepolia.etherscan.io/tx/";
    return `${baseUrl}${hash}`;
  };

  if (!isConnected) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("betaPhaseAirdrop")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {timeRemaining ? (
          <Alert>
            <AlertTitle>{t("cooldownPeriod")}</AlertTitle>
            <AlertDescription>
              {t("canClaimAgainIn", { time: timeRemaining })}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("error")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {txHash ? (
          <Alert className="bg-green-50 border-green-200">
            <AlertTitle>{t("success")}</AlertTitle>
            <AlertDescription>
              {t("raffle:transactionSubmitted")}:{" "}
              <a
                href={getExplorerUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </a>
            </AlertDescription>
          </Alert>
        ) : null}

        <p className="text-center text-muted-foreground">
          {t("claimEveryNCooldown", {
            amount: faucetData
              ? parseFloat(faucetData.amountPerRequest).toLocaleString()
              : "0",
            cooldown: faucetData
              ? Math.round(faucetData.cooldownPeriod / 3600)
              : "6",
          })}
        </p>
        <Button
          onClick={handleClaim}
          disabled={!isClaimable || isLoading}
          className="w-full"
        >
          {isLoading ? t("raffle:processing") : t("claimSofTokens")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default MobileFaucetWidget;
