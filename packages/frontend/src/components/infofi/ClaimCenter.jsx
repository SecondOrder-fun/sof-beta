// src/components/infofi/ClaimCenter.jsx
import PropTypes from "prop-types";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { getAddress } from "viem";
import { useWatchContractLogs } from "@/hooks/chain/useWatchContractLogs";
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
import { buildPublicClient } from "@/lib/viemClient";
import { getContractAddresses } from "@/config/contracts";
import { getPrizeDistributor } from "@/services/onchainRaffleDistributor";
import {
  RafflePrizeDistributorAbi as PrizeDistributorAbi,
  RaffleAbi,
} from "@/utils/abis";
import { useClaims } from "@/hooks/useClaims";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";
import TransactionModal from "@/components/admin/TransactionModal";
import ClaimCenterRaffles from "./claim/ClaimCenterRaffles";
import ClaimCenterMarkets from "./claim/ClaimCenterMarkets";

// Position-id getter on the SimpleFPMM contract — outcome 0 = YES, 1 = NO.
const FPMM_POSITION_IDS_ABI = [
  {
    type: "function",
    name: "positionIds",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
];

// ERC-1155 balanceOf on ConditionalTokens.
const CONDITIONAL_TOKENS_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      { name: "owner", type: "address" },
      { name: "positionId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
];

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

  // Modal status adapters for each claim mutation.
  const claimInfoFiStatus = useTransactionStatus(claimInfoFiOne);
  const claimFPMMStatus = useTransactionStatus(claimFPMMOne);
  const claimConsolationStatus = useTransactionStatus(claimRaffleConsolation);
  const claimGrandStatus = useTransactionStatus(claimRaffleGrand);

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
    // Discovery + winnings come from listener-driven SSE channels
    // (MarketCreated / MarketResolved). Drop refetchInterval — the data
    // gets invalidated when relevant events fire on the chain. Mount-only
    // fetch with a 30s window for stale-while-revalidate on quick remounts.
    staleTime: 30_000,
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
  });

  // FPMM Claims — batched via multicall.
  //
  // For each settled market we need (a) the YES/NO positionIds on the FPMM
  // and (b) the user's balanceOf for the *winning* outcome on
  // ConditionalTokens. The previous implementation called readFpmmPosition
  // sequentially twice per market (YES then NO), which spun up a fresh
  // viem client per call and meant 4 RPC reads per market with no
  // aggregation. The poll cadence was 5s, so a Portfolio open with 3
  // settled markets was running 12 reads every 5 seconds (~140/min).
  //
  // Now: one multicall for all positionIds across all settled markets,
  // then one multicall for all balanceOfs. Two RPC round-trips total,
  // mount-only (refetchInterval dropped — claim state flips on the
  // FPMMClaimed event which the executeBatch invalidation handles).
  const fpmmClaimsQuery = useQuery({
    queryKey: [
      "claimcenter_fpmm_claimables",
      address,
      netKey,
      (discovery.data || []).length,
    ],
    enabled: !!address && Array.isArray(discovery.data),
    queryFn: async () => {
      const settledMarkets = (discovery.data || []).filter(
        (m) => m.isSettled && m.player && m.contractAddress,
      );
      if (settledMarkets.length === 0) return [];

      const client = buildPublicClient(netKey);
      const addrs = getContractAddresses(netKey);
      if (!client || !addrs.CONDITIONAL_TOKENS) return [];

      // Step 1: positionIds(0) [YES] for every settled market.
      const positionIdResults = await client.multicall({
        contracts: settledMarkets.map((m) => ({
          address: m.contractAddress,
          abi: FPMM_POSITION_IDS_ABI,
          functionName: "positionIds",
          args: [m.winningOutcome === true ? 0n : 1n],
        })),
        allowFailure: true,
      });

      // Step 2: ConditionalTokens.balanceOf(user, positionId) for every
      // successful positionId from step 1.
      const balanceCalls = [];
      const marketMeta = [];
      positionIdResults.forEach((r, i) => {
        if (r.status !== "success" || r.result == null) return;
        marketMeta.push({ market: settledMarkets[i], positionId: r.result });
        balanceCalls.push({
          address: addrs.CONDITIONAL_TOKENS,
          abi: CONDITIONAL_TOKENS_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [getAddress(address), r.result],
        });
      });

      if (balanceCalls.length === 0) return [];

      const balanceResults = await client.multicall({
        contracts: balanceCalls,
        allowFailure: true,
      });

      const out = [];
      balanceResults.forEach((r, i) => {
        if (r.status !== "success" || !r.result || r.result === 0n) return;
        const { market } = marketMeta[i];
        const isYesWin = market.winningOutcome === true;
        out.push({
          seasonId: market.seasonId,
          player: market.player,
          contractAddress: market.contractAddress,
          yesAmount: isYesWin ? r.result : 0n,
          noAmount: isYesWin ? 0n : r.result,
          winningOutcome: market.winningOutcome,
          type: "fpmm",
        });
      });
      return out;
    },
    staleTime: Infinity,
  });

  // Raffle Prize Claims
  // getPrizeDistributor resolves from the contracts bundle (no RPC), so the
  // value is constant for the lifetime of the network. Drop the 10s
  // polling and cache forever — the queryFn is a synchronous lookup.
  const distributorQuery = useQuery({
    queryKey: ["rewards_distributor", netKey],
    queryFn: () => getPrizeDistributor({ networkKey: netKey }),
    staleTime: Infinity,
  });

  // Watch for ConsolationClaimed events ONLY while a claim is in flight.
  // The watcher exists to flip pending → success and fire a toast when the
  // user's own claim tx confirms; before the user clicks claim there's
  // nothing to watch for. ClaimCenter mounts on every Profile / Portfolio
  // view, so leaving this enabled persistently was polling getLogs every
  // 12s for the entire page lifetime. Narrowed to pendingClaims.size > 0
  // (mirrors useRafflePrizes' claimStatus === "claiming" pattern).
  useWatchContractLogs({
    address: distributorQuery.data,
    abi: PrizeDistributorAbi,
    eventName: "ConsolationClaimed",
    enabled: Boolean(
      distributorQuery.data &&
        address &&
        connectedAddress &&
        pendingClaims.size > 0,
    ),
    onLogs: (logs) => {
      logs.forEach((log) => {
        const participant = log?.args?.account || log?.args?.participant;
        if (
          participant &&
          address &&
          participant.toLowerCase() === address.toLowerCase()
        ) {
          qc.invalidateQueries({ queryKey: ["raffle_claims"] });
        }
      });
    },
  });

  // Same gating as the ConsolationClaimed watcher above — only enabled
  // while pendingClaims.size > 0.
  useWatchContractLogs({
    address: distributorQuery.data,
    abi: PrizeDistributorAbi,
    eventName: "GrandClaimed",
    enabled: Boolean(
      distributorQuery.data &&
        address &&
        connectedAddress &&
        pendingClaims.size > 0,
    ),
    onLogs: (logs) => {
      logs.forEach((log) => {
        const winner = log?.args?.winner;
        if (
          winner &&
          address &&
          winner.toLowerCase() === address.toLowerCase()
        ) {
          qc.invalidateQueries({ queryKey: ["raffle_claims"] });
        }
      });
    },
  });

  // Raffle prize claims — gated + batched.
  //
  // Only Completed (status 5) and Cancelled (status 6) seasons can have
  // claimable prizes; Active/Upcoming/Settling get filtered out so we
  // don't waste reads on seasons that can't possibly have anything to
  // claim. The three per-season reads (getSeason payouts on distributor,
  // getParticipantPosition on raffle, isConsolationClaimed on distributor)
  // are batched into three multicalls instead of running 3N sequential
  // awaits.
  //
  // Mount-only — claim state flips on the ConsolationClaimed / GrandClaimed
  // watchers (gated to pendingClaims above) which invalidate ["raffle_claims"].
  const claimEligibleSeasons = (allSeasonsQuery.data || []).filter((s) => {
    const n = Number(s?.status);
    return n === 5 || n === 6;
  });

  const raffleClaimsQuery = useQuery({
    queryKey: [
      "raffle_claims",
      address,
      netKey,
      claimEligibleSeasons.map((s) => s.id).join(","),
    ],
    enabled:
      !!address &&
      !!distributorQuery.data &&
      claimEligibleSeasons.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const distributor = distributorQuery.data;
      if (!distributor) return [];
      const addrs = getContractAddresses(netKey);
      if (!addrs.RAFFLE) return [];
      const client = buildPublicClient(netKey);
      if (!client) return [];

      const seasonIds = claimEligibleSeasons.map((s) => Number(s.id));
      const checksumAddr = getAddress(address);

      // Batch 1: PrizeDistributor.getSeason(seasonId) for every eligible season.
      const payoutResults = await client.multicall({
        contracts: seasonIds.map((sid) => ({
          address: distributor,
          abi: PrizeDistributorAbi,
          functionName: "getSeason",
          args: [BigInt(sid)],
        })),
        allowFailure: true,
      });

      // Batch 2: Raffle.getParticipantPosition(seasonId, user) — only for
      // seasons whose payouts came back funded.
      const participantCalls = [];
      const participantMeta = [];
      payoutResults.forEach((r, i) => {
        if (r.status !== "success" || !r.result?.funded) return;
        participantMeta.push({ sid: seasonIds[i], payout: r.result });
        participantCalls.push({
          address: addrs.RAFFLE,
          abi: RaffleAbi,
          functionName: "getParticipantPosition",
          args: [BigInt(seasonIds[i]), checksumAddr],
        });
      });

      let participantResults = [];
      if (participantCalls.length > 0) {
        participantResults = await client.multicall({
          contracts: participantCalls,
          allowFailure: true,
        });
      }

      // Batch 3: PrizeDistributor.isConsolationClaimed for every season
      // where the user was a participant. (For grand-prize entries we read
      // grandClaimed directly off the payout result from batch 1.)
      const claimCheckCalls = [];
      const claimCheckMeta = [];
      participantMeta.forEach((meta, i) => {
        const pos = participantResults[i];
        const ticketCount =
          pos?.status === "success" ? BigInt(pos.result?.ticketCount ?? 0n) : 0n;
        const isParticipant = ticketCount > 0n;
        const isGrandWinner = Boolean(
          meta.payout.grandWinner &&
            meta.payout.grandWinner.toLowerCase() === address.toLowerCase(),
        );
        meta.isParticipant = isParticipant;
        meta.isGrandWinner = isGrandWinner;
        if (!isParticipant || isGrandWinner) return;
        claimCheckMeta.push(meta);
        claimCheckCalls.push({
          address: distributor,
          abi: PrizeDistributorAbi,
          functionName: "isConsolationClaimed",
          args: [BigInt(meta.sid), checksumAddr],
        });
      });

      let claimCheckResults = [];
      if (claimCheckCalls.length > 0) {
        claimCheckResults = await client.multicall({
          contracts: claimCheckCalls,
          allowFailure: true,
        });
      }

      const out = [];
      // Grand-prize entries first.
      participantMeta.forEach((meta) => {
        if (!meta.isGrandWinner) return;
        if (meta.payout.grandClaimed) return;
        out.push({
          seasonId: meta.sid,
          type: "raffle-grand",
          amount: meta.payout.grandAmount,
          claimed: meta.payout.grandClaimed,
        });
      });
      // Consolation entries from batch 3.
      claimCheckMeta.forEach((meta, i) => {
        const claimRes = claimCheckResults[i];
        const alreadyClaimed =
          claimRes?.status === "success" ? Boolean(claimRes.result) : false;
        if (alreadyClaimed) return;
        const totalParticipants = BigInt(meta.payout.totalParticipants ?? 0n);
        const consolationAmount = BigInt(meta.payout.consolationAmount ?? 0n);
        if (totalParticipants <= 1n || consolationAmount === 0n) return;
        const loserCount = totalParticipants - 1n;
        const perLoser = consolationAmount / loserCount;
        if (perLoser <= 0n) return;
        out.push({
          seasonId: meta.sid,
          type: "raffle-consolation",
          amount: perLoser,
          claimed: false,
        });
      });
      return out;
    },
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
              <TabsTrigger value="raffles">{t('common:raffle_prizes')}</TabsTrigger>
              <TabsTrigger value="markets">{t('common:prediction_markets')}</TabsTrigger>
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
      <TransactionModal
        mutation={claimInfoFiStatus}
        title={t("market:claimingInfoFi", { defaultValue: "Claiming InfoFi payout" })}
      />
      <TransactionModal
        mutation={claimFPMMStatus}
        title={t("market:claimingFPMM", { defaultValue: "Claiming market position" })}
      />
      <TransactionModal
        mutation={claimConsolationStatus}
        title={t("raffle:claimingConsolation", { defaultValue: "Claiming consolation prize" })}
      />
      <TransactionModal
        mutation={claimGrandStatus}
        title={t("raffle:claimingGrand", { defaultValue: "Claiming grand prize" })}
      />
    </Card>
  );
};

ClaimCenter.propTypes = {
  address: PropTypes.string,
  title: PropTypes.string,
  description: PropTypes.string,
};

export default ClaimCenter;
