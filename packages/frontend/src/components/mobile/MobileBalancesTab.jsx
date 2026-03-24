// src/components/mobile/MobileBalancesTab.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ExternalLink, ChevronRight } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import InfoFiPositionsTab from "@/components/account/InfoFiPositionsTab";

/**
 * MobileBalancesTab - Mobile-optimized balances display with Raffles/InfoFi toggle
 * Uses consistent UI Gym accordion style for both sections
 */
const MobileBalancesTab = ({
  address,
  sofBalance,
  rafflePositions,
  isLoadingRafflePositions = false,
}) => {
  const { t } = useTranslation(["account", "market", "common"]);

  const sortedRafflePositions = (rafflePositions || [])
    .slice()
    .sort((a, b) => Number(b.seasonId) - Number(a.seasonId));

  return (
    <div className="space-y-3 mt-3">
      {/* SOF Balance Display */}
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">
            {t("account:sofBalance")}
          </div>
          <div className="text-2xl font-bold text-foreground">{sofBalance}</div>
        </CardContent>
      </Card>

      {/* Raffle Holdings / InfoFi Positions toggle */}
      <Tabs defaultValue="raffles" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="raffles" className="flex-1">
            {t("account:raffleTickets")}
          </TabsTrigger>
          <TabsTrigger value="infofi" className="flex-1">
            {t("account:infoFi")}
          </TabsTrigger>
          <TabsTrigger value="nfts" className="flex-1">
            NFTs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="raffles" className="space-y-3">
          {isLoadingRafflePositions ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {t("common:loading", { defaultValue: "Loading..." })}
              </span>
            </div>
          ) : rafflePositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("account:noTicketBalances")}
            </p>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {sortedRafflePositions.map((position) => (
                <AccordionItem
                  key={`raffle-${position.seasonId}`}
                  value={`raffle-${position.seasonId}`}
                >
                  <AccordionTrigger className="px-3 py-2 text-left">
                    <div className="flex items-center justify-between w-full">
                      <span className="font-medium text-foreground">
                        #{position.seasonId} - {position.name}
                      </span>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-foreground">
                          {position.ticketCount}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">
                          tickets
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="mt-2 border-t border-border pt-3 space-y-3">
                      {position.bondingCurve && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground font-mono truncate">
                            {t("account:raffleContract")}: {position.bondingCurve.slice(0, 6)}...{position.bondingCurve.slice(-4)}
                          </span>
                          <a
                            href={`https://sepolia.basescan.org/address/${position.bondingCurve}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-primary/80 flex items-center shrink-0 ml-2"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground font-mono truncate">
                          {t("account:token")}: {position.token.slice(0, 6)}...{position.token.slice(-4)}
                        </span>
                        <a
                          href={`https://sepolia.basescan.org/token/${position.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80 flex items-center shrink-0 ml-2"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <Link
                        to={`/raffles/${position.seasonId}`}
                        className="flex items-center justify-between p-3 bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                      >
                        <span className="text-foreground font-medium">
                          Go to Raffle
                        </span>
                        <ChevronRight className="h-4 w-4 text-primary" />
                      </Link>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        <TabsContent value="infofi">
          <InfoFiPositionsTab address={address} />
        </TabsContent>

        <TabsContent value="nfts">
          <Card>
            <CardHeader>
              <CardTitle>NFT Gallery</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p>{t("common:comingSoon")}</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

MobileBalancesTab.propTypes = {
  address: PropTypes.string,
  sofBalance: PropTypes.string.isRequired,
  isLoadingRafflePositions: PropTypes.bool,
  rafflePositions: PropTypes.arrayOf(
    PropTypes.shape({
      seasonId: PropTypes.oneOfType([PropTypes.number, PropTypes.string])
        .isRequired,
      name: PropTypes.string.isRequired,
      token: PropTypes.string.isRequired,
      bondingCurve: PropTypes.string,
      ticketCount: PropTypes.string.isRequired,
    }),
  ).isRequired,
};

export default MobileBalancesTab;
