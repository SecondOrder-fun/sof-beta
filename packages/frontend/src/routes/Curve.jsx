// src/routes/Curve.jsx
import { useMemo, useState } from "react";
import { useRaffleRead, useSeasonDetailsQuery } from "@/hooks/useRaffleRead";
import { useCurveState } from "@/hooks/useCurveState";
import CurveGraph from "@/components/curve/CurveGraph";
import BuySellWidget from "@/components/curve/BuySellWidget";
import TransactionsTab from "@/components/curve/TransactionsTab";
import TokenInfoTab from "@/components/curve/TokenInfoTab";
import HoldersTab from "@/components/curve/HoldersTab";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Raffle Ticket Bonding Curve page (GLICO-style)
 * - Graph (left)
 * - Buy/Sell widget (right)
 * - Tabs: Transactions | Token Info | Token Holders
 */
const Curve = () => {
  const { currentSeasonQuery } = useRaffleRead();
  const seasonId = currentSeasonQuery.data ?? null;
  const seasonDetailsQuery = useSeasonDetailsQuery(seasonId);
  const bondingCurveAddress = seasonDetailsQuery?.data?.config?.bondingCurve;
  const isActive = seasonDetailsQuery?.data?.status === 1;

  const {
    curveSupply,
    curveReserves,
    curveStep,
    allBondSteps,
    debouncedRefresh,
  } = useCurveState(bondingCurveAddress, { isActive, pollMs: 12000 });

  const [activeTab, setActiveTab] = useState("transactions");

  const header = useMemo(() => {
    const symbol = "TICKET"; // placeholder, can be read from curve if exposed
    const current = Number(curveSupply || 0n);
    const max = (() => {
      try {
        // If steps known, last step rangeTo equals max supply
        const last =
          Array.isArray(allBondSteps) && allBondSteps.length > 0
            ? allBondSteps[allBondSteps.length - 1]
            : null;
        return Number(last?.rangeTo ?? 0n);
      } catch {
        return 0;
      }
    })();
    return { symbol, current, max };
  }, [curveSupply, allBondSteps]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bonding Curve</h1>
          <p className="text-sm text-muted-foreground">
            Raffle ticket token bonding curve overview
          </p>
        </div>
        <div className="text-right text-sm">
          <div>
            Current / Max Supply:{" "}
            <span className="font-mono">{header.current}</span> /{" "}
            <span className="font-mono">{header.max}</span>
          </div>
          <div>
            Contract:{" "}
            <span className="font-mono">{bondingCurveAddress || "—"}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Bonding Curve Graph</CardTitle>
            <CardDescription>
              Step progress, current price and supply
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CurveGraph
              curveSupply={curveSupply}
              curveStep={curveStep}
              allBondSteps={allBondSteps}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Buy / Sell</CardTitle>
            <CardDescription>Purchase or sell raffle tickets</CardDescription>
          </CardHeader>
          <CardContent>
            <BuySellWidget
              bondingCurveAddress={bondingCurveAddress}
              onTxSuccess={() => debouncedRefresh(500)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity & Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="token-info">Token Info</TabsTrigger>
              <TabsTrigger value="holders">Token Holders</TabsTrigger>
            </TabsList>
            <TabsContent value="transactions">
              <TransactionsTab bondingCurveAddress={bondingCurveAddress} />
            </TabsContent>
            <TabsContent value="token-info">
              <TokenInfoTab
                bondingCurveAddress={bondingCurveAddress}
                curveSupply={curveSupply}
                allBondSteps={allBondSteps}
                curveReserves={curveReserves}
              />
            </TabsContent>
            <TabsContent value="holders">
              <HoldersTab bondingCurveAddress={bondingCurveAddress} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Curve;
