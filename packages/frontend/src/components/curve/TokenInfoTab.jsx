// src/components/curve/TokenInfoTab.jsx
import PropTypes from "prop-types";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
}) => {
  const { t } = useTranslation("common");
  const [raffleTokenSymbol, setRaffleTokenSymbol] = useState("TIX");
  const [walletToast, setWalletToast] = useState(null);
  const [walletToastVisible, setWalletToastVisible] = useState(false);

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
  // cache for the rest of the session. The canonical getter is
  // `raffleToken()` (SOFBondingCurve.sol declares `IRaffleToken public
  // raffleToken;`); the older 5-name probe (token/raffleToken/
  // ticketToken/tickets/asset) is gone. If a future contract change
  // renames the getter, the call reverts and the regression is loud —
  // exactly the behaviour we want vs a silent fallback to a stale name.
  const netKey = getStoredNetworkKey();
  const raffleTokenQuery = useQuery({
    queryKey: ["raffleTokenAddress", netKey, bondingCurveAddress?.toLowerCase?.()],
    enabled: !!bondingCurveAddress,
    staleTime: Infinity,
    queryFn: async () => {
      const client = buildPublicClient(netKey);
      if (!client) return null;

      const addr = await client.readContract({
        address: bondingCurveAddress,
        abi: SOFBondingCurveAbi,
        functionName: "raffleToken",
        args: [],
      });

      const isValid =
        typeof addr === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(addr) &&
        addr !== "0x0000000000000000000000000000000000000000";
      return isValid ? addr : null;
    },
  });
  const raffleTokenAddress = raffleTokenQuery.data ?? null;

  return (
    <div className="space-y-4">
      <div>
        {/* Addresses + supply */}
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
      </div>
    </div>
  );
};

TokenInfoTab.propTypes = {
  bondingCurveAddress: PropTypes.string,
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  curveSupply: PropTypes.oneOfType([PropTypes.string, PropTypes.bigint]),
  allBondSteps: PropTypes.array,
};

export default TokenInfoTab;
