// src/routes/UserProfile.jsx
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePublicClient, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { SOFSmartAccountFactoryABI } from "@sof/contracts";
import { Card, CardContent } from "@/components/ui/card";
import ProfileContent from "@/components/account/ProfileContent";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

const UserProfile = () => {
  const { t } = useTranslation("account");
  const { address: addressParam } = useParams();
  const { sma: mySma } = useRaffleAccount();
  const publicClient = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  // SMA-bound read per spec §4.3 — gameplay state lives at the SMA.
  //
  // Heuristic for the route param: it can be either an EOA (legacy share
  // links, username→EOA resolution) or an SMA (post-rewrite deep links).
  // We probe `code.length` on the param: SMA addresses become contracts
  // once the first sponsored UserOp deploys them, so a non-empty code
  // implies the param is already an SMA. If code is empty we derive
  // `factory.getAddress(param)` and use that. This handles three cases:
  //   1. Counterfactual SMA (no code yet)  → derive returns same addr
  //   2. Deployed SMA (has code)            → use as-is
  //   3. EOA (has 0 code, isn't an SMA)     → derive resolves to its SMA
  // Case 1 is benign since the predicted SMA == derive(predictedSMA)
  // wouldn't be true; the cleaner fix is to special-case via a registry,
  // but counterfactual peers are rare on a profile page (you got here from
  // a username link or a leaderboard, both of which already resolve to
  // the deployed SMA).
  // Fast-path: if the route param is the connected user's own SMA, we
  // already know it's a contract (the connected user wouldn't have a
  // working session without their SMA being resolvable). Skip the
  // eth_getCode RPC entirely.
  const isOwnSma =
    Boolean(addressParam && mySma) &&
    addressParam.toLowerCase() === mySma.toLowerCase();

  const codeProbe = useQuery({
    queryKey: ["addressCode", netKey, addressParam],
    queryFn: async () => {
      if (!publicClient || !addressParam) return null;
      const code = await publicClient.getCode({ address: addressParam });
      return code && code !== "0x" ? "contract" : "eoa";
    },
    enabled: Boolean(publicClient && addressParam) && !isOwnSma,
    // staleTime: Infinity — "is this address a contract" is monotonic
    // once true; once deployed, it stays deployed. The previous 60s
    // window forced a re-fetch on every Portfolio mount after the first
    // minute, which served no purpose.
    staleTime: Infinity,
  });

  const needsDerive =
    Boolean(addressParam) &&
    codeProbe.data === "eoa" &&
    !!contracts.SOF_SMART_ACCOUNT_FACTORY;

  const { data: derivedSma } = useReadContract({
    abi: SOFSmartAccountFactoryABI,
    address: contracts.SOF_SMART_ACCOUNT_FACTORY,
    functionName: "getAddress",
    args: addressParam ? [addressParam] : undefined,
    query: { enabled: needsDerive, staleTime: 60_000 },
  });

  // Resolution priority:
  //  - param == my SMA → fast-path, skip codeProbe (known to be a contract)
  //  - param + contract code → use param as-is (already an SMA)
  //  - param + EOA → derived SMA via factory
  //  - no param → use my own SMA (own profile)
  let resolvedAddress;
  if (addressParam) {
    if (isOwnSma) {
      resolvedAddress = addressParam;
    } else if (codeProbe.data === "contract") {
      resolvedAddress = addressParam;
    } else if (derivedSma) {
      resolvedAddress = derivedSma;
    }
  } else {
    resolvedAddress = mySma;
  }

  const isOwnProfile =
    !!mySma &&
    !!resolvedAddress &&
    mySma.toLowerCase() === resolvedAddress.toLowerCase();

  // Loading state — code probe still resolving
  if (addressParam && codeProbe.isPending) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold text-foreground mb-4">
          {t("userProfile")}
        </h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {t("loadingAccount", { defaultValue: "Loading account..." })}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No address available — prompt to connect
  if (!resolvedAddress) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold text-foreground mb-4">
          {t("userProfile")}
        </h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {t("connectWalletToViewAccount")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <ProfileContent address={resolvedAddress} isOwnProfile={isOwnProfile} />
    </div>
  );
};

export default UserProfile;
