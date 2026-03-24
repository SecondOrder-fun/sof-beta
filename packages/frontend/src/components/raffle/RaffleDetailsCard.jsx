// src/components/raffle/RaffleDetailsCard.jsx
import { useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits } from "viem";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useRaffle } from "@/hooks/useRaffle";
import { useSOFToken } from "@/hooks/useSOFToken";
import { useSeasonGating } from "@/hooks/useSeasonGating";
import { formatAddress, formatTimestamp } from "@/lib/utils";
import CountdownTimer from "@/components/common/CountdownTimer";
import GatingVerification from "@/components/raffle/GatingVerification";

/**
 * RaffleDetailsCard component for displaying and interacting with a raffle
 */
const RaffleDetailsCard = ({ seasonId }) => {
  const { t } = useTranslation("raffle");
  const { address, isConnected } = useAccount();
  const { seasonDetails, userPosition, winners, isLoading, error, buyTickets } =
    useRaffle(seasonId);
  const { balance: sofBalance } = useSOFToken();
  const { isVerified, hasGates, refetchVerified } = useSeasonGating(seasonId);

  const [ticketAmount, setTicketAmount] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [txHash, setTxHash] = useState("");

  // Handle buying tickets
  const handleBuyTickets = async () => {
    if (!ticketAmount || !maxCost) return;

    setTxHash("");
    try {
      const result = await buyTickets({
        amount: parseUnits(ticketAmount, 0), // Tickets are whole numbers
        maxCost: parseUnits(maxCost, 18), // SOF has 18 decimals
      });

      if (result?.hash) {
        setTxHash(result.hash);
        setTicketAmount("");
        setMaxCost("");
      }
    } catch (err) {
      // Error is handled by the hook
    }
  };

  // Get explorer URL for transaction
  const getExplorerUrl = (hash) => {
    if (!hash) return "#";

    // This is a simplified version - in a real app, you'd use the network config
    const baseUrl =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
        ? "#" // No explorer for local
        : "https://sepolia.etherscan.io/tx/";

    return `${baseUrl}${hash}`;
  };

  // Render loading state
  if (isLoading && !seasonDetails) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-center items-center h-40">
            <p className="text-muted-foreground">{t("loadingDetails")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render not found state
  if (!seasonDetails) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert variant="destructive">
            <AlertTitle>{t("raffleNotFound")}</AlertTitle>
            <AlertDescription>
              {t("raffleNotFoundDescription", { seasonId })}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("seasonNumber", { number: seasonId })}</CardTitle>
        <CardDescription>
          {seasonDetails.isActive ? (
            <span className="text-green-600 flex items-center gap-1">
              {t("active")} -{" "}
              <CountdownTimer targetTimestamp={seasonDetails.endTime} compact />
            </span>
          ) : seasonDetails.isEnded ? (
            <span className="text-amber-600">{t("ended")}</span>
          ) : (
            <span className="text-muted-foreground">{t("pending")}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("yourPosition")}
            </h3>
            <p className="text-2xl font-bold">
              {t("ticketCount", { count: userPosition.ticketCount })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("chanceToWin", {
                percent: userPosition.probability.toFixed(2),
              })}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("totalTickets")}
            </h3>
            <p className="text-2xl font-bold">
              {seasonDetails.totalTickets
                ? seasonDetails.totalTickets.toLocaleString()
                : "0"}
            </p>
          </div>
        </div>

        {/* Winners section (if resolved) */}
        {seasonDetails.isResolved && winners.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">{t("winnersTitle")}</h3>
            <div className="space-y-2">
              {winners.map((winner, index) => (
                <div
                  key={index}
                  className="flex justify-between items-center p-2 bg-muted rounded-md"
                >
                  <span>
                    {t("winnerNumber", {
                      number: index + 1,
                      address: formatAddress(winner),
                    })}
                  </span>
                  {winner.toLowerCase() === address?.toLowerCase() && (
                    <span className="text-green-600 font-semibold">
                      {t("youWon")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gating verification (if season is gated) */}
        {seasonDetails.isActive && isConnected && hasGates && !isVerified && (
          <div className="mt-6">
            <GatingVerification
              seasonId={seasonId}
              onVerified={refetchVerified}
            />
          </div>
        )}

        {/* Buy tickets form (if active and verified) */}
        {seasonDetails.isActive && isConnected && isVerified && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-2">
              {t("buyTicketsTitle")}
            </h3>

            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>{t("common:error")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {txHash && (
              <Alert className="mb-4 bg-green-50 border-green-200">
                <AlertTitle>{t("common:success")}</AlertTitle>
                <AlertDescription>
                  {t("transactionSubmitted")}:{" "}
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
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("ticketAmount")}
                </label>
                <Input
                  type="number"
                  value={ticketAmount}
                  onChange={(e) => setTicketAmount(e.target.value)}
                  placeholder={t("numberOfTickets")}
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("maxCost")}
                </label>
                <Input
                  type="number"
                  value={maxCost}
                  onChange={(e) => setMaxCost(e.target.value)}
                  placeholder={t("maximumSofToSpend")}
                  min="1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("yourBalance", {
                    balance: parseFloat(sofBalance).toLocaleString(),
                  })}
                </p>
              </div>
            </div>

            <Button
              onClick={handleBuyTickets}
              disabled={isLoading || !ticketAmount || !maxCost}
              className="w-full"
            >
              {isLoading ? t("processing") : t("buyTickets")}
            </Button>
          </div>
        )}

        {/* Not connected message */}
        {!isConnected && (
          <Alert>
            <AlertTitle>{t("connectWallet")}</AlertTitle>
            <AlertDescription>{t("connectWalletDescription")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="border-t pt-4 flex flex-wrap justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          <span>
            {t("start")}: {formatTimestamp(seasonDetails.startTime)}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          <span>
            {t("end")}: {formatTimestamp(seasonDetails.endTime)}
          </span>
        </div>
        {seasonDetails.isActive && (
          <div className="text-sm flex items-center gap-1">
            <span className="text-muted-foreground">{t("endsIn")}:</span>
            <CountdownTimer
              targetTimestamp={seasonDetails.endTime}
              compact
              className="text-green-600"
            />
          </div>
        )}
      </CardFooter>
    </Card>
  );
};

RaffleDetailsCard.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
};

export default RaffleDetailsCard;
