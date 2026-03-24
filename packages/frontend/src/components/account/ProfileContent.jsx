// src/components/account/ProfileContent.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useWatchContractEvent } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion } from "@/components/ui/accordion";
import {
  Carousel,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import RaffleHoldingRow from "@/components/raffle/RaffleHoldingRow";
import InfoFiPositionsTab from "@/components/account/InfoFiPositionsTab";
import { SOFTransactionHistory } from "@/components/user/SOFTransactionHistory";
import { ClaimPrizeWidget } from "@/components/prizes/ClaimPrizeWidget";
import ClaimCenter from "@/components/infofi/ClaimCenter";
import { useProfileData } from "@/hooks/useProfileData";
import { useUsername } from "@/hooks/useUsername";
import { useUsernameContext } from "@/context/UsernameContext";
import { RafflePrizeDistributorAbi as PrizeDistributorAbi } from "@/utils/abis";

/**
 * ProfileContent - Shared profile layout used by AccountPage (desktop) and UserProfile.
 *
 * @param {string} address - Wallet address to display
 * @param {boolean} isOwnProfile - Whether this is the connected user's own profile
 */
const ProfileContent = ({ address, isOwnProfile }) => {
  const { t } = useTranslation(["account", "common"]);
  const { data: username } = useUsername(address);
  const { setShowDialog } = useUsernameContext();

  const {
    sofBalanceQuery,
    seasonBalancesQuery,
    winningSeasonsQuery,
    contracts,
    allSeasonsQuery,
  } = useProfileData(address);

  const winningSeasons = winningSeasonsQuery.data || [];

  // Live SOF refresh on ConsolationClaimed (own profile only)
  useWatchContractEvent({
    address: contracts.PRIZE_DISTRIBUTOR,
    abi: PrizeDistributorAbi,
    eventName: "ConsolationClaimed",
    enabled: Boolean(
      isOwnProfile && address && contracts.PRIZE_DISTRIBUTOR
    ),
    onLogs: (logs) => {
      logs.forEach((log) => {
        const participant = log?.args?.participant || log?.args?.account;
        if (
          participant &&
          address &&
          participant.toLowerCase() === address.toLowerCase()
        ) {
          sofBalanceQuery.refetch?.();
        }
      });
    },
  });

  return (
    <div>
      {/* Username header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            {username ? (
              <>
                {username}
                {isOwnProfile && (
                  <Badge variant="secondary">{t("common:you")}</Badge>
                )}
              </>
            ) : (
              t(isOwnProfile ? "account:myAccount" : "account:userProfile")
            )}
          </h1>
          {address && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("account:address")}:{" "}
              <span className="font-mono">{address}</span>
            </p>
          )}
        </div>
        {isOwnProfile && (
          <Button variant="outline" onClick={() => setShowDialog(true)}>
            {username
              ? t("common:editUsername")
              : t("common:setUsername")}
          </Button>
        )}
      </div>

      {/* Winning seasons carousel (own profile only) */}
      {isOwnProfile &&
        Array.isArray(allSeasonsQuery.data) &&
        winningSeasons.length > 0 && (
          <div className="mb-4 flex flex-col items-center w-full">
            <Carousel className="w-full max-w-md">
              {winningSeasons.length > 1 && <CarouselPrevious />}
              {winningSeasons.length > 1 && <CarouselNext />}
              {winningSeasons.map((s) => (
                <CarouselItem key={`claim-${String(s.id)}`}>
                  <ClaimPrizeWidget seasonId={s.id} />
                </CarouselItem>
              ))}
            </Carousel>
          </div>
        )}

      {/* Holdings card — 3-tab layout */}
      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("account:balance")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sof" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sof">SOF Holdings</TabsTrigger>
                <TabsTrigger value="raffle">
                  {t("account:raffleHoldings")}
                </TabsTrigger>
                <TabsTrigger value="infofi">InfoFi Positions</TabsTrigger>
              </TabsList>

              <TabsContent value="sof" className="mt-4">
                <SOFTransactionHistory address={address} embedded />
              </TabsContent>

              <TabsContent value="raffle" className="mt-4">
                {seasonBalancesQuery.isLoading && (
                  <p className="text-muted-foreground">
                    {t("common:loading")}
                  </p>
                )}
                {seasonBalancesQuery.error && (
                  <p className="text-red-500">
                    {t("account:errorLoadingTicketBalances")}
                  </p>
                )}
                {!seasonBalancesQuery.isLoading &&
                  !seasonBalancesQuery.error && (
                    <div className="h-80 overflow-y-auto overflow-x-hidden pr-1">
                      {(seasonBalancesQuery.data || []).length === 0 && (
                        <p className="text-muted-foreground">
                          {t("account:noTicketBalances")}
                        </p>
                      )}
                      {(seasonBalancesQuery.data || []).length > 0 && (
                        <Accordion type="multiple" className="space-y-2">
                          {(seasonBalancesQuery.data || [])
                            .slice()
                            .sort(
                              (a, b) =>
                                Number(b.seasonId) - Number(a.seasonId)
                            )
                            .map((row) => (
                              <RaffleHoldingRow
                                key={row.seasonId}
                                row={row}
                                address={address}
                                showViewLink={false}
                              />
                            ))}
                        </Accordion>
                      )}
                    </div>
                  )}
              </TabsContent>

              <TabsContent value="infofi" className="mt-4">
                <InfoFiPositionsTab address={address} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* ClaimCenter (own profile only) */}
      {isOwnProfile && <ClaimCenter address={address} />}
    </div>
  );
};

ProfileContent.propTypes = {
  address: PropTypes.string.isRequired,
  isOwnProfile: PropTypes.bool.isRequired,
};

export default ProfileContent;
