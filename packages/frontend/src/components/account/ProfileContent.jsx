// src/components/account/ProfileContent.jsx
import { useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
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
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import RolloverPortfolioCard from "@/components/user/RolloverPortfolioCard";

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
  // Own profile gets a merged EOA + SMA transaction history (plan 5.11);
  // other-profile views remain single-address (we don't know the viewed
  // user's EOA from an SMA route param).
  const { eoa, sma } = useRaffleAccount();
  const transactionAddresses = useMemo(() => {
    if (!isOwnProfile) return [address];
    return [eoa, sma].filter(Boolean).map((a) => a.toLowerCase());
  }, [isOwnProfile, address, eoa, sma]);
  // Origin badge metadata so the table can render `EOA` / `SMA` badges
  // without re-deriving which-is-which.
  const originLabels = useMemo(() => {
    if (!isOwnProfile) return {};
    const labels = {};
    if (eoa) labels[eoa.toLowerCase()] = "EOA";
    if (sma) labels[sma.toLowerCase()] = "SMA";
    return labels;
  }, [isOwnProfile, eoa, sma]);

  const {
    seasonBalancesQuery,
    winningSeasonsQuery,
    allSeasonsQuery,
  } = useProfileData(address);

  const winningSeasons = winningSeasonsQuery.data || [];

  // Note: a ConsolationClaimed useWatchContractLogs that called
  // sofBalanceQuery.refetch lived here previously. It only ever fired for
  // the user's OWN claim (the participant === address gate filtered out
  // everyone else), and the user's own claim tx already invalidates the
  // ultra-fresh SOF balance read via executeBatch's touches mechanism.
  // The watcher was polling getLogs every 12s for the lifetime of every
  // Portfolio view to handle a case that's already handled — dropped.

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

      {/* Rollover position — rendered when available */}
      {isOwnProfile && (() => {
        const latestEndedId = (allSeasonsQuery.data || [])
          .filter((s) => s.status === "ended" || s.status === "settled")
          .sort((a, b) => Number(b.id) - Number(a.id))[0]?.id;
        return latestEndedId ? (
          <div className="mb-4">
            <RolloverPortfolioCard seasonId={latestEndedId} />
          </div>
        ) : null;
      })()}

      {/* Holdings card — 3-tab layout */}
      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("account:balance")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sof" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sof">{t('common:account_sof_holdings')}</TabsTrigger>
                <TabsTrigger value="raffle">
                  {t("account:raffleHoldings")}
                </TabsTrigger>
                <TabsTrigger value="infofi">{t('common:account_infofi_positions')}</TabsTrigger>
              </TabsList>

              <TabsContent value="sof" className="mt-4">
                <SOFTransactionHistory
                  addresses={transactionAddresses}
                  originLabels={originLabels}
                  embedded
                />
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
                                addresses={transactionAddresses}
                                originLabels={originLabels}
                                showViewLink={false}
                              />
                            ))}
                        </Accordion>
                      )}
                    </div>
                  )}
              </TabsContent>

              <TabsContent value="infofi" className="mt-4">
                <InfoFiPositionsTab
                  addresses={transactionAddresses}
                  originLabels={originLabels}
                />
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
