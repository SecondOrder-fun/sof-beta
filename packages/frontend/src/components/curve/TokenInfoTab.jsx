// src/components/curve/TokenInfoTab.jsx
import PropTypes from "prop-types";
import { useMemo, useState, useEffect } from "react";
import { formatUnits } from "viem";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSofDecimals } from "@/hooks/useSofDecimals";
import { useRaffleHolders } from "@/hooks/useRaffleHolders";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { buildPublicClient } from "@/lib/viemClient";
import { SOFBondingCurveAbi } from "@/utils/abis";
import AddTokenToMetamaskButton from "@/components/common/AddTokenToMetamaskButton";
import SecondaryCard from "@/components/common/SecondaryCard";
import ExplorerLink from "@/components/common/ExplorerLink";

const TokenInfoTab = ({
  bondingCurveAddress,
  seasonId,
  curveSupply,
  allBondSteps,
  curveReserves,
  seasonStatus,
  totalPrizePool,
}) => {
  const { t } = useTranslation("common");
  const sofDecimals = useSofDecimals();
  const [raffleTokenSymbol, setRaffleTokenSymbol] = useState("TIX");
  const [walletToast, setWalletToast] = useState(null);
  const [walletToastVisible, setWalletToastVisible] = useState(false);

  // Get actual participants count from holders (users with active positions)
  const { totalHolders } = useRaffleHolders(bondingCurveAddress, seasonId);
  const totalParticipants = totalHolders;

  const formatSOF = (v) => {
    try {
      return Number(formatUnits(v ?? 0n, sofDecimals)).toFixed(4);
    } catch {
      return "0.0000";
    }
  };
  const maxSupply = useMemo(() => {
    try {
      const last =
        Array.isArray(allBondSteps) && allBondSteps.length > 0
          ? allBondSteps[allBondSteps.length - 1]
          : null;
      return last?.rangeTo ?? 0n;
    } catch {
      return 0n;
    }
  }, [allBondSteps]);

  // Derive the ticket token symbol directly from the season number.
  // Convention: SOF-x where x is the season id.
  useEffect(() => {
    if (seasonId !== undefined && seasonId !== null) {
      setRaffleTokenSymbol(`SOF-${seasonId}`);
    }
  }, [seasonId]);

  const handleWalletResult = (result) => {
    setWalletToast(result);
    setWalletToastVisible(true);

    // Fade out over the last 0.5s of the 4.5s display window.
    window.setTimeout(() => {
      setWalletToastVisible(false);
    }, 4000);

    window.setTimeout(() => {
      setWalletToast(null);
    }, 4500);
  };

  // Fetch raffle/ticket token address from the bonding curve.
  //
  // The address is set once at season creation and never changes, so this
  // query carries staleTime: Infinity — the result lives in react-query's
  // cache for the rest of the session. Older curve implementations
  // exposed the getter under different names (token / raffleToken /
  // ticketToken / tickets / asset); we probe in parallel and take the
  // first valid address. viem's batch.multicall aggregator collapses the
  // five reads into a single aggregate3 call, so the cold-load cost is
  // one RPC round-trip even though four of the probes revert.
  const netKey = getStoredNetworkKey();
  const raffleTokenQuery = useQuery({
    queryKey: ["raffleTokenAddress", netKey, bondingCurveAddress?.toLowerCase?.()],
    enabled: !!bondingCurveAddress,
    staleTime: Infinity,
    queryFn: async () => {
      const client = buildPublicClient(netKey);
      if (!client) return null;

      const candidateFns = ["token", "raffleToken", "ticketToken", "tickets", "asset"];
      const results = await Promise.allSettled(
        candidateFns.map((fn) =>
          client.readContract({
            address: bondingCurveAddress,
            abi: SOFBondingCurveAbi,
            functionName: fn,
            args: [],
          }),
        ),
      );

      const validAddr = results
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .find(
          (addr) =>
            typeof addr === "string" &&
            /^0x[a-fA-F0-9]{40}$/.test(addr) &&
            addr !== "0x0000000000000000000000000000000000000000",
        );

      return validAddr ?? bondingCurveAddress;
    },
  });
  const raffleTokenAddress = raffleTokenQuery.data ?? null;

  // Calculate prize distribution (65% grand prize, 35% consolation by default)
  // Note: grandPrizeBps can be configured per season, defaulting to 6500 (65%)
  const grandPrize = useMemo(() => {
    try {
      const reserves = curveReserves ?? 0n;
      const grandPrizeBps = 6500n; // Default from contract
      return (reserves * grandPrizeBps) / 10000n;
    } catch {
      return 0n;
    }
  }, [curveReserves]);

  const consolationPerUser = useMemo(() => {
    try {
      if (totalParticipants <= 1) return 0n; // Need at least 2 participants (1 winner, 1+ losers)
      const reserves = curveReserves ?? 0n;
      const grandPrizeBps = 6500n;
      const grand = (reserves * grandPrizeBps) / 10000n;
      const consolation = reserves - grand;
      // Divide by (totalParticipants - 1) since winner doesn't get consolation
      return consolation / BigInt(totalParticipants - 1);
    } catch {
      return 0n;
    }
  }, [curveReserves, totalParticipants]);

  const isSeasonActive = seasonStatus === 1; // SeasonStatus.Active (see `SeasonStatus` enum in `contracts/src/core/RaffleStorage.sol`)
  const displayedPrizePool = isSeasonActive
    ? curveReserves ?? 0n
    : totalPrizePool ?? curveReserves ?? 0n;

  return (
    <div className="space-y-4">
      {/* Two-column layout: left = addresses + supply, right = prize info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          {/* Contract Addresses */}
          <div className="space-y-3">
            <SecondaryCard title={t("bondingCurveAddress")}>
              <ExplorerLink value={bondingCurveAddress} type="address" />
            </SecondaryCard>
            <div className="relative">
              <SecondaryCard
                title={t("raffleTokenAddress")}
                right={
                  <div>
                    <AddTokenToMetamaskButton
                      address={raffleTokenAddress}
                      symbol={raffleTokenSymbol}
                      decimals={0}
                      label="Add to Wallet"
                      size="sm"
                      variant="outline"
                      disabled={!(raffleTokenAddress || bondingCurveAddress)}
                      onResult={handleWalletResult}
                    />
                  </div>
                }
              >
                <ExplorerLink value={raffleTokenAddress} type="token" />
              </SecondaryCard>

              {walletToast && (
                <div
                  className={`absolute inset-0 flex items-center justify-center rounded-md bg-foreground/60 transition-opacity duration-500 ${
                    walletToastVisible
                      ? "opacity-100"
                      : "opacity-0 pointer-events-none"
                  }`}
                >
                  <div
                    className={`mx-4 rounded-md border px-4 py-3 text-sm shadow-lg ${
                      walletToast.type === "success"
                        ? "bg-green-50 border-green-200 text-green-900"
                        : "bg-red-50 border-red-200 text-red-900"
                    }`}
                  >
                    <div className="mb-1 font-semibold">
                      {walletToast.type === "success" ? "Success" : "Error"}
                    </div>
                    <div>{walletToast.message}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Token Supply Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SecondaryCard title={t("currentSupply")}>
              <div className="font-mono">
                {curveSupply?.toString?.() ?? "0"}
              </div>
            </SecondaryCard>
            <SecondaryCard title={t("maxSupply")}>
              <div className="font-mono">{maxSupply?.toString?.() ?? "0"}</div>
            </SecondaryCard>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* Prize Pool Distribution */}
          <div className="border rounded p-4 bg-muted/30 h-full">
            <h3 className="font-semibold mb-3">{t("prizePoolDistribution")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 border rounded bg-background">
                <div className="text-sm text-muted-foreground">
                  {t("grandPrize")} (65%)
                </div>
                <div className="font-mono text-lg font-bold text-green-600">
                  {formatSOF(grandPrize)} SOF
                </div>
              </div>
              <div className="p-3 border rounded bg-background">
                <div className="text-sm text-muted-foreground">
                  {t("consolationPerUser")} (35% ÷{" "}
                  {totalParticipants > 1 ? totalParticipants - 1 : "?"})
                </div>
                <div className="font-mono text-lg font-bold text-blue-600">
                  {totalParticipants > 1
                    ? `${formatSOF(consolationPerUser)} SOF`
                    : t("waitingForParticipants")}
                </div>
              </div>
            </div>
            <div className="mt-3 p-3 border rounded bg-background">
              <div className="text-sm text-muted-foreground">
                {t("totalPrizePool")}
              </div>
              <div className="font-mono text-xl font-bold">
                {formatSOF(displayedPrizePool)} SOF
              </div>
              {!isSeasonActive && totalPrizePool != null && (
                <div className="text-xs text-muted-foreground">
                  {t("seasonLockedSnapshot")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

TokenInfoTab.propTypes = {
  bondingCurveAddress: PropTypes.string,
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  curveSupply: PropTypes.oneOfType([PropTypes.string, PropTypes.bigint]),
  allBondSteps: PropTypes.array,
  curveReserves: PropTypes.oneOfType([PropTypes.string, PropTypes.bigint]),
  seasonStatus: PropTypes.number,
  totalPrizePool: PropTypes.oneOfType([PropTypes.string, PropTypes.bigint]),
};

export default TokenInfoTab;
