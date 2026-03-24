// src/components/infofi/ClaimCenter.jsx
import PropTypes from "prop-types";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAccount, useWatchContractEvent } from "wagmi";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { readFpmmPosition } from "@/services/onchainInfoFi";
import {
  getPrizeDistributor,
  getSeasonPayouts,
  isConsolationClaimed,
  isSeasonParticipant,
} from "@/services/onchainRaffleDistributor";
import { RafflePrizeDistributorAbi as PrizeDistributorAbi } from "@/utils/abis";
import { useToast } from "@/hooks/useToast";
import { formatUnits } from "viem";
import { useClaims } from "@/hooks/useClaims";
import ClaimCenterRaffles from "./claim/ClaimCenterRaffles";
import ClaimCenterMarkets from "./claim/ClaimCenterMarkets";

/**
 * ClaimCenter - Unified interface for claiming both InfoFi market winnings and raffle prizes
 */
const ClaimCenter = ({ address, title, description }) => {
  const { t } = useTranslation(["market", "raffle", "common"]);
  const netKey = getStoredNetworkKey();
  const qc = useQueryClient();
  const [tabValue, setTabValue] = useState("raffles");
  const allSeasonsQuery = useAllSeasons();
  const { address: connectedAddress } = useAccount();
  const { toast } = useToast();

  // Use extracted claim hooks
  const {
    pendingClaims,
    successfulClaims,
    getClaimKey,
    claimInfoFiOne,
    claimFPMMOne,
    claimRaffleConsolation,
    claimRaffleGrand,
  } = useClaims();

  // InfoFi Market Claims - fetch from backend API
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const discovery = useQuery({
    queryKey: ["claimcenter_discovery", netKey],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/infofi/markets?isActive=false`);
      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.status}`);
      }
      const data = await response.json();
      const allMarkets = [];
      for (const [seasonId, markets] of Object.entries(data.markets || {})) {
        for (const m of markets) {
          allMarkets.push({
            id: String(m.id),
            seasonId: Number(seasonId),
            raffle_id: Number(seasonId),
            player: m.player_address,
            contractAddress: m.contract_address,
            isSettled: m.is_settled,
            winningOutcome: m.winning_outcome,
          });
        }
      }
      return allMarkets;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const claimsQuery = useQuery({
    queryKey: ["claimcenter_claimables", address, netKey],
    enabled: !!address,
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/infofi/winnings/${address}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch winnings: ${response.status}`);
      }
      const data = await response.json();
      const winnings = data.winnings || [];

      const out = [];
      for (const winning of winnings) {
        if (!winning.market || !winning.market.contract_address) continue;

        const amount = parseFloat(winning.amount);
        if (amount <= 0) continue;

        out.push({
          seasonId: Number(winning.market.season_id),
          marketId: String(winning.market_id),
          prediction: winning.market.winning_outcome,
          payout: BigInt(Math.floor(amount * 1e18)),
          contractAddress: winning.market.contract_address,
          type: "infofi",
        });
      }
      return out;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // FPMM Claims
  const fpmmClaimsQuery = useQuery({
    queryKey: [
      "claimcenter_fpmm_claimables",
      address,
      netKey,
      (discovery.data || []).length,
    ],
    enabled: !!address && Array.isArray(discovery.data),
    queryFn: async () => {
      const out = [];
      const settledMarkets = (discovery.data || []).filter(
        (m) => m.isSettled && m.player,
      );

      for (const market of settledMarkets) {
        const { seasonId, player, winningOutcome, contractAddress } = market;
        try {
          const yesPosition = await readFpmmPosition({
            seasonId,
            player,
            account: address,
            prediction: true,
            networkKey: netKey,
            fpmmAddress: contractAddress,
          });

          const noPosition = await readFpmmPosition({
            seasonId,
            player,
            account: address,
            prediction: false,
            networkKey: netKey,
            fpmmAddress: contractAddress,
          });

          const hasClaimableYes =
            winningOutcome === true && yesPosition.amount > 0n;
          const hasClaimableNo =
            winningOutcome === false && noPosition.amount > 0n;

          if (hasClaimableYes || hasClaimableNo) {
            out.push({
              seasonId,
              player,
              contractAddress,
              yesAmount: hasClaimableYes ? yesPosition.amount : 0n,
              noAmount: hasClaimableNo ? noPosition.amount : 0n,
              winningOutcome,
              type: "fpmm",
            });
          }
        } catch (err) {
          // Skip markets that error
        }
      }
      return out;
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  // Raffle Prize Claims
  const distributorQuery = useQuery({
    queryKey: ["rewards_distributor", netKey],
    queryFn: () => getPrizeDistributor({ networkKey: netKey }),
    staleTime: 10000,
    refetchInterval: 10000,
  });

  // Watch for ConsolationClaimed events
  useWatchContractEvent({
    address: distributorQuery.data,
    abi: PrizeDistributorAbi,
    eventName: "ConsolationClaimed",
    enabled: Boolean(distributorQuery.data && address && connectedAddress),
    onLogs: (logs) => {
      logs.forEach((log) => {
        const participant = log?.args?.account || log?.args?.participant;
        if (
          participant &&
          address &&
          participant.toLowerCase() === address.toLowerCase()
        ) {
          qc.invalidateQueries({ queryKey: ["raffle_claims"] });
          qc.invalidateQueries({ queryKey: ["sofBalance"] });
          const amount = log?.args?.amount;
          toast({
            title: t("raffle:prizeClaimed"),
            description:
              typeof amount === "bigint"
                ? `${t("raffle:consolationPrize")}: ${formatUnits(
                    amount,
                    18,
                  )} SOF`
                : t("transactions:confirmed"),
            variant: "success",
          });
        }
      });
    },
  });

  // Watch for GrandClaimed events
  useWatchContractEvent({
    address: distributorQuery.data,
    abi: PrizeDistributorAbi,
    eventName: "GrandClaimed",
    enabled: Boolean(distributorQuery.data && address && connectedAddress),
    onLogs: (logs) => {
      logs.forEach((log) => {
        const winner = log?.args?.winner;
        if (
          winner &&
          address &&
          winner.toLowerCase() === address.toLowerCase()
        ) {
          qc.invalidateQueries({ queryKey: ["raffle_claims"] });
          qc.invalidateQueries({ queryKey: ["sofBalance"] });
          const amount = log?.args?.amount;
          toast({
            title: t("raffle:prizeClaimed"),
            description:
              typeof amount === "bigint"
                ? `${t("raffle:grandPrize")}: ${formatUnits(amount, 18)} SOF`
                : t("transactions:confirmed"),
            variant: "success",
          });
        }
      });
    },
  });

  const raffleClaimsQuery = useQuery({
    queryKey: [
      "raffle_claims",
      address,
      netKey,
      (allSeasonsQuery.data || []).map((s) => s.id).join(","),
    ],
    enabled:
      !!address &&
      !!distributorQuery.data &&
      !!allSeasonsQuery.data &&
      (allSeasonsQuery.data || []).length > 0,
    queryFn: async () => {
      const out = [];
      const seasons = allSeasonsQuery.data || [];

      for (const season of seasons) {
        const seasonId = Number(season.id);
        const payout = await getSeasonPayouts({
          seasonId,
          networkKey: netKey,
        }).catch(() => null);
        if (!payout || !payout.data?.funded) continue;

        const grandWinner = payout.data.grandWinner;
        const isGrandWinner = Boolean(
          grandWinner &&
          address &&
          grandWinner.toLowerCase() === address.toLowerCase(),
        );

        // Grand prize claim for the single winner
        if (isGrandWinner && !payout.data.grandClaimed) {
          out.push({
            seasonId,
            type: "raffle-grand",
            amount: payout.data.grandAmount,
            claimed: payout.data.grandClaimed,
          });
          continue;
        }

        // Consolation prize claims for non-winning participants
        try {
          const totalParticipants = BigInt(payout.data.totalParticipants ?? 0n);
          const consolationAmount = BigInt(payout.data.consolationAmount ?? 0n);

          if (!address || totalParticipants <= 1n || consolationAmount === 0n) {
            continue;
          }

          const wasParticipant = await isSeasonParticipant({
            seasonId,
            account: address,
            networkKey: netKey,
          });

          if (!wasParticipant) {
            continue;
          }

          const alreadyClaimed = await isConsolationClaimed({
            seasonId,
            account: address,
            networkKey: netKey,
          });
          if (!alreadyClaimed && !isGrandWinner) {
            const loserCount = totalParticipants - 1n;
            if (loserCount > 0n) {
              const perLoser = consolationAmount / loserCount;
              if (perLoser > 0n) {
                out.push({
                  seasonId,
                  type: "raffle-consolation",
                  amount: perLoser,
                  claimed: false,
                });
              }
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            "Failed to evaluate consolation eligibility for season",
            seasonId,
            err,
          );
        }
      }
      return out;
    },
    staleTime: 10000,
    refetchInterval: 10000,
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{title || t("market:claimWinnings")}</CardTitle>
        <CardDescription>
          {description ||
            t("market:claimDescription", {
              defaultValue: "Claimable raffle prizes and market winnings.",
            })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!address && (
          <p className="text-muted-foreground">{t("errors:notConnected")}</p>
        )}
        {address && (
          <Tabs value={tabValue} onValueChange={setTabValue} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="raffles">Raffle Prizes</TabsTrigger>
              <TabsTrigger value="markets">Prediction Markets</TabsTrigger>
            </TabsList>

            <TabsContent value="markets" className="space-y-4">
              <ClaimCenterMarkets
                discovery={discovery}
                claimsQuery={claimsQuery}
                fpmmClaimsQuery={fpmmClaimsQuery}
                pendingClaims={pendingClaims}
                successfulClaims={successfulClaims}
                getClaimKey={getClaimKey}
                claimInfoFiOne={claimInfoFiOne}
                claimFPMMOne={claimFPMMOne}
              />
            </TabsContent>

            <TabsContent value="raffles" className="space-y-4">
              <ClaimCenterRaffles
                raffleClaimsQuery={raffleClaimsQuery}
                pendingClaims={pendingClaims}
                successfulClaims={successfulClaims}
                getClaimKey={getClaimKey}
                claimRaffleGrand={claimRaffleGrand}
                claimRaffleConsolation={claimRaffleConsolation}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};

ClaimCenter.propTypes = {
  address: PropTypes.string,
  title: PropTypes.string,
  description: PropTypes.string,
};

export default ClaimCenter;
