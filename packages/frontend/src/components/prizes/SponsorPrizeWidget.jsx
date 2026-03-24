import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, parseUnits, encodeFunctionData } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gift } from "lucide-react";
import { useSponsoredPrizes } from "@/hooks/useSponsoredPrizes";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { RafflePrizeDistributorAbi } from "@/utils/abis";
import { ERC20Abi, ERC721ApproveAbi } from "@/utils/abis";
import PropTypes from "prop-types";

const TAB_KEYS = {
  erc20: "sponsorPrizeERC20",
  erc721: "sponsorPrizeERC721",
  offchain: "sponsorPrizeOffchain",
};
const TABS = Object.keys(TAB_KEYS);

export function SponsorPrizeWidget({ seasonId }) {
  const { t } = useTranslation("raffle");
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { tierConfigs } = useSponsoredPrizes(seasonId);
  const { executeBatch } = useSmartTransactions();

  const [tab, setTab] = useState("erc20");
  const [tokenAddress, setTokenAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [targetTier, setTargetTier] = useState(0);
  const [description, setDescription] = useState("");
  const [chainId, setChainId] = useState(1);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  const netKey = getStoredNetworkKey();
  const addresses = getContractAddresses(netKey);

  const getTierLabel = (index) => {
    if (index === 0) return t("tierGrandPrize");
    if (index === 1) return t("tierRunnerUp");
    if (index === 2) return t("tierThirdPlace");
    return t("tierLabel", { number: index + 1 });
  };

  const handleSponsorERC20 = async () => {
    setError("");
    if (!isAddress(tokenAddress)) { setError(t("invalidAddress")); return; }
    if (!amount || Number(amount) <= 0) { setError(t("amountMustBePositive")); return; }

    setIsPending(true);
    try {
      const tokenDecimals = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20Abi,
        functionName: "decimals",
      });
      const parsedAmount = parseUnits(amount, tokenDecimals);

      // Read distributor address from Raffle contract
      const distributorAddr = await publicClient.readContract({
        address: addresses.RAFFLE,
        abi: [{ name: "prizeDistributor", type: "function", inputs: [], outputs: [{ type: "address" }] }],
        functionName: "prizeDistributor",
      });

      await executeBatch([
        {
          to: tokenAddress,
          data: encodeFunctionData({
            abi: ERC20Abi,
            functionName: "approve",
            args: [distributorAddr, parsedAmount],
          }),
        },
        {
          to: distributorAddr,
          data: encodeFunctionData({
            abi: RafflePrizeDistributorAbi,
            functionName: "sponsorERC20",
            args: [BigInt(seasonId), tokenAddress, parsedAmount, BigInt(targetTier)],
          }),
        },
      ]);

      // Reset form
      setTokenAddress("");
      setAmount("");
    } catch (err) {
      setError(err.message || t("transactionFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const handleSponsorERC721 = async () => {
    setError("");
    if (!isAddress(tokenAddress)) { setError(t("invalidAddress")); return; }
    if (!tokenId || !/^\d+$/.test(tokenId.trim())) { setError(t("tokenIdRequired")); return; }

    setIsPending(true);
    try {
      const distributorAddr = await publicClient.readContract({
        address: addresses.RAFFLE,
        abi: [{ name: "prizeDistributor", type: "function", inputs: [], outputs: [{ type: "address" }] }],
        functionName: "prizeDistributor",
      });

      await executeBatch([
        {
          to: tokenAddress,
          data: encodeFunctionData({
            abi: ERC721ApproveAbi,
            functionName: "approve",
            args: [distributorAddr, BigInt(tokenId)],
          }),
        },
        {
          to: distributorAddr,
          data: encodeFunctionData({
            abi: RafflePrizeDistributorAbi,
            functionName: "sponsorERC721",
            args: [BigInt(seasonId), tokenAddress, BigInt(tokenId), BigInt(targetTier)],
          }),
        },
      ]);

      setTokenAddress("");
      setTokenId("");
    } catch (err) {
      setError(err.message || t("transactionFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const handleSponsorOffchain = async () => {
    setError("");
    if (!isAddress(tokenAddress)) { setError(t("invalidAddress")); return; }

    setIsPending(true);
    try {
      const res = await fetch(`/api/sponsor-prizes/${seasonId}/offchain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          tokenAddress,
          tokenId: tokenId || undefined,
          description: description || undefined,
          sponsorAddress: address,
          targetTier,
          prizeType: tokenId ? "erc721" : "erc20",
        }),
      });
      if (!res.ok) throw new Error("Failed to create off-chain prize");
      setTokenAddress("");
      setTokenId("");
      setDescription("");
    } catch (err) {
      setError(err.message || t("offchainPrizeFailed"));
    } finally {
      setIsPending(false);
    }
  };

  if (!address) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4" />
          {t("sponsorPrizeBtn")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tab selector */}
        <div className="flex gap-1">
          {TABS.map((tabKey) => (
            <Badge
              key={tabKey}
              variant={tab === tabKey ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => { setTab(tabKey); setError(""); }}
            >
              {t(TAB_KEYS[tabKey])}
            </Badge>
          ))}
        </div>

        {/* Token address */}
        <Input
          placeholder={t("sponsorTokenAddress")}
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
        />

        {/* Amount (ERC-20 only) */}
        {tab === "erc20" && (
          <Input
            type="number"
            placeholder={t("sponsorAmount")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        )}

        {/* Token ID (ERC-721 or off-chain NFT) */}
        {(tab === "erc721" || tab === "offchain") && (
          <Input
            placeholder={t("sponsorTokenId")}
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
          />
        )}

        {/* Description (off-chain only) */}
        {tab === "offchain" && (
          <>
            <Input
              placeholder={t("sponsorDescription")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">{t("sponsorChain")}</label>
              <select
                value={chainId}
                onChange={(e) => setChainId(Number(e.target.value))}
                className="text-sm border border-border rounded px-2 py-1 bg-background"
              >
                <option value={1}>{t("chainEthereum")}</option>
                <option value={8453}>{t("chainBase")}</option>
                <option value={10}>{t("chainOptimism")}</option>
                <option value={42161}>{t("chainArbitrum")}</option>
              </select>
            </div>
          </>
        )}

        {/* Tier selector */}
        {tierConfigs.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">{t("sponsorTargetTier")}</label>
            <select
              value={targetTier}
              onChange={(e) => setTargetTier(Number(e.target.value))}
              className="text-sm border border-border rounded px-2 py-1 bg-background"
            >
              {tierConfigs.map((_, index) => (
                <option key={index} value={index}>{getTierLabel(index)}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          onClick={
            tab === "erc20" ? handleSponsorERC20 :
            tab === "erc721" ? handleSponsorERC721 :
            handleSponsorOffchain
          }
          disabled={isPending}
          className="w-full"
        >
          {isPending ? t("sponsoring") : t("sponsorPrizeBtn")}
        </Button>
      </CardContent>
    </Card>
  );
}

SponsorPrizeWidget.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};
