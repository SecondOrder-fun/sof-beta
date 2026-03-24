// src/components/mobile/MobilePortfolio.jsx
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BottomNav from "./BottomNav";
import MobileCreatorTab from "./MobileCreatorTab";
import MobileBalancesTab from "./MobileBalancesTab";
import MobileClaimsTab from "./MobileClaimsTab";
import { useProfileData } from "@/hooks/useProfileData";

/**
 * MobilePortfolio - Mobile-optimized portfolio page with tab navigation
 */
const MobilePortfolio = () => {
  const { address, isConnected } = useAccount();
  const { t } = useTranslation(["account", "common"]);

  const { sofBalanceQuery, seasonBalancesQuery } = useProfileData(address);

  const sofBalance = useMemo(() => {
    try {
      const raw = formatUnits(sofBalanceQuery.data ?? 0n, 18);
      const num = parseFloat(raw);
      return isNaN(num) ? "0.0000" : num.toFixed(4);
    } catch {
      return "0.0000";
    }
  }, [sofBalanceQuery.data]);

  const rafflePositions = seasonBalancesQuery.data || [];

  if (!isConnected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-muted-foreground text-center">
            {t("account:connectWalletToViewAccount")}
          </p>
        </div>
        <BottomNav activeTab="portfolio" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden flex flex-col px-3 pt-1 pb-20">
        <h1 className="text-2xl font-bold text-foreground text-left mb-3">
          {t("account:myAccount")}
        </h1>

        <Tabs
          defaultValue="balances"
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="w-full">
            <TabsTrigger value="balances" className="flex-1">
              {t("account:holdings")}
            </TabsTrigger>
            <TabsTrigger value="claims" className="flex-1">
              {t("account:claims")}
            </TabsTrigger>
            <TabsTrigger value="creator" className="flex-1">
              {t("account:creator")}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="balances" className="mt-0">
              <MobileBalancesTab
                address={address}
                sofBalance={sofBalance}
                rafflePositions={rafflePositions}
                isLoadingRafflePositions={seasonBalancesQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="claims" className="mt-0">
              <MobileClaimsTab address={address} />
            </TabsContent>

            <TabsContent value="creator" className="mt-0">
              <MobileCreatorTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <BottomNav activeTab="portfolio" />
    </div>
  );
};

export default MobilePortfolio;
