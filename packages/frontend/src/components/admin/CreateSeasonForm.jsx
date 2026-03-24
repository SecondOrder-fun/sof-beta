// src/components/admin/CreateSeasonForm.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { isAddress, decodeEventLog, encodeFunctionData, parseUnits } from "viem";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { CalendarIcon, Check, Gift, Plus, Trash2 } from "lucide-react";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { AUTO_START_BUFFER_SECONDS } from "@/lib/seasonTime";
import { getContractAddresses, RAFFLE_ABI, SEASON_GATING_ABI } from "@/config/contracts";
import { getStoredNetworkKey } from '@/lib/wagmi';
import { ERC20Abi, ERC721ApproveAbi, RafflePrizeDistributorAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { MetaMaskCircuitBreakerAlert } from "@/components/common/MetaMaskCircuitBreakerAlert";
import TransactionModal from "@/components/admin/TransactionModal";
import BondingCurveEditor from "@/components/admin/BondingCurveEditor";
import GatingConfig from "@/components/admin/GatingConfig";

// Helper: format epoch seconds to a local "YYYY-MM-DDTHH:mm" string for <input type="datetime-local">
const fmtLocalDatetime = (sec) => {
  const d = new Date(sec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

// ERC20 ABI imported from centralized utility

// Constants for default times (outside component to avoid useEffect dependency warnings)
const DEFAULT_START_OFFSET_SECONDS = 5 * 60; // 5 minutes from now
const DEFAULT_DURATION_SECONDS = 7 * 24 * 60 * 60; // 1 week

const CreateSeasonForm = ({ createSeason, chainTimeQuery, activeSection = "all" }) => {
  const { t } = useTranslation("raffle");
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [sofDecimals, setSofDecimals] = useState(18);
  const [grandPct, setGrandPct] = useState("65");
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [formError, setFormError] = useState("");

  const [nameError, setNameError] = useState("");
  const [treasuryError, setTreasuryError] = useState("");

  // Confirmation dialog
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingSubmitData, setPendingSubmitData] = useState(null);
  const confirmedDataRef = useRef(null);

  // Bonding curve data from editor
  const [curveData, setCurveData] = useState({
    steps: [],
    maxTickets: 100000,
    isValid: false,
  });

  // Gating configuration
  const [gated, setGated] = useState(false);
  const [gatingGates, setGatingGates] = useState([]);
  const [gatingStatus, setGatingStatus] = useState(""); // "", "pending", "success", "error"

  // Tier configuration
  const [tiers, setTiers] = useState([{ winnerCount: 1 }]); // Default: 1 grand prize winner

  // Sponsored prizes (collected during creation, executed after season tx confirms)
  const [sponsoredPrizes, setSponsoredPrizes] = useState([]);
  const [sponsorStatus, setSponsorStatus] = useState(""); // "", "pending", "success", "error"

  const { executeBatch } = useSmartTransactions();

  const publicClient = usePublicClient();
  const { address } = useAccount();
  const netKey = getStoredNetworkKey();
  const addresses = getContractAddresses(netKey);
  
  // For configuring gates after season creation
  const { writeContractAsync: writeGatingContract } = useWriteContract();

  // Handle curve editor changes
  const handleCurveChange = useCallback((data) => {
    setCurveData(data);
  }, []);

  // Get current chain time for UI
  const nowSecUi = useMemo(() => {
    return typeof chainTimeQuery.data === "number"
      ? chainTimeQuery.data
      : Math.floor(Date.now() / 1000);
  }, [chainTimeQuery.data]);

  // Parse manual start time
  const manualStartSecUi = useMemo(() => {
    if (!startTime) return null;
    const parsed = Math.floor(new Date(startTime).getTime() / 1000);
    return Number.isFinite(parsed) ? parsed : null;
  }, [startTime]);

  // Check if start time is too soon
  const startTooSoonUi = useMemo(() => {
    if (!manualStartSecUi) return false;
    return manualStartSecUi - nowSecUi <= AUTO_START_BUFFER_SECONDS;
  }, [manualStartSecUi, nowSecUi]);

  // Load SOF decimals
  useEffect(() => {
    let cancelled = false;
    async function loadDecimals() {
      try {
        if (!addresses.SOF || !publicClient) return;
        const dec = await publicClient.readContract({
          address: addresses.SOF,
          abi: ERC20Abi,
          functionName: "decimals",
        });
        if (!cancelled && typeof dec === "number") setSofDecimals(dec);
      } catch (_) {
        // ignore; default 18
      }
    }
    loadDecimals();
    return () => {
      cancelled = true;
    };
  }, [addresses.SOF, publicClient]);

  // Set initial start time if not set (Now + 5 minutes)
  useEffect(() => {
    if (startTime) return;
    const nowSec =
      typeof chainTimeQuery.data === "number"
        ? chainTimeQuery.data
        : Math.floor(Date.now() / 1000);
    const minStartSec = nowSec + DEFAULT_START_OFFSET_SECONDS;
    setStartTime(fmtLocalDatetime(minStartSec));
  }, [startTime, chainTimeQuery.data]);

  // Auto-set end time when start time changes (Start + 1 week)
  useEffect(() => {
    if (!startTime || endTime) return;
    const startSec = Math.floor(new Date(startTime).getTime() / 1000);
    if (Number.isFinite(startSec)) {
      setEndTime(fmtLocalDatetime(startSec + DEFAULT_DURATION_SECONDS));
    }
  }, [startTime, endTime]);

  // Helper to reset dates to defaults
  const resetToDefaultDates = () => {
    const nowSec =
      typeof chainTimeQuery.data === "number"
        ? chainTimeQuery.data
        : Math.floor(Date.now() / 1000);
    const newStartSec = nowSec + DEFAULT_START_OFFSET_SECONDS;
    setStartTime(fmtLocalDatetime(newStartSec));
    setEndTime(fmtLocalDatetime(newStartSec + DEFAULT_DURATION_SECONDS));
  };

  // Handle form errors from mutation
  useEffect(() => {
    if (createSeason?.isError && createSeason?.error) {
      setFormError(createSeason.error.message);
    }
  }, [createSeason?.isError, createSeason?.error]);

  // Configure gates and reset form on successful season creation
  useEffect(() => {
    let cancelled = false;

    if (!createSeason?.isConfirmed || !createSeason?.receipt) return;

    // Parse seasonId from SeasonCreated event in receipt
    const seasonCreatedLog = createSeason.receipt.logs.find((log) => {
      try {
        const decoded = decodeEventLog({
          abi: RAFFLE_ABI,
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === "SeasonCreated";
      } catch {
        return false;
      }
    });

    if (!seasonCreatedLog) {
      setStartTime("");
      setEndTime("");
      return;
    }

    const decoded = decodeEventLog({
      abi: RAFFLE_ABI,
      data: seasonCreatedLog.data,
      topics: seasonCreatedLog.topics,
    });
    const seasonId = decoded.args.seasonId;

    // If gated with gates configured, call configureGates
    if (gated && gatingGates.length > 0 && addresses.SEASON_GATING) {
      setGatingStatus("pending");

      // Format gates for contract: [{ gateType, enabled, configHash }]
      const formattedGates = gatingGates.map((g) => ({
        gateType: g.gateType,
        enabled: g.enabled,
        configHash: g.configHash,
      }));

      writeGatingContract({
        address: addresses.SEASON_GATING,
        abi: SEASON_GATING_ABI,
        functionName: "configureGates",
        args: [seasonId, formattedGates],
      })
        .then(async (hash) => {
          // Wait for confirmation
          if (publicClient) {
            await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
          }
          if (!cancelled) setGatingStatus("success");
        })
        .catch((err) => {
          if (!cancelled) {
            setGatingStatus("error");
            setFormError(`Season created but failed to configure gates: ${err.message}`);
          }
        });
    }

    // Execute sponsored prize transactions if any were configured
    const confirmedPrizes = confirmedDataRef.current?.sponsoredPrizes || [];
    if (confirmedPrizes.length > 0 && addresses.RAFFLE) {
      setSponsorStatus("pending");

      (async () => {
        try {
          // Read distributor address from the newly deployed Raffle
          const distributorAddr = await publicClient.readContract({
            address: addresses.RAFFLE,
            abi: RAFFLE_ABI,
            functionName: "prizeDistributor",
          });

          // Build batch calls: approve + sponsor for each prize
          const calls = [];
          for (const prize of confirmedPrizes) {
            if (prize.type === "offchain") continue; // handled separately via backend API
            const tokenAddr = prize.tokenAddress.trim();
            const tier = BigInt(prize.targetTier || 0);

            if (prize.type === "erc20") {
              const tokenDecimals = await publicClient.readContract({
                address: tokenAddr,
                abi: ERC20Abi,
                functionName: "decimals",
              });
              const parsedAmount = parseUnits(prize.amount, tokenDecimals);
              calls.push({
                to: tokenAddr,
                data: encodeFunctionData({
                  abi: ERC20Abi,
                  functionName: "approve",
                  args: [distributorAddr, parsedAmount],
                }),
              });
              calls.push({
                to: distributorAddr,
                data: encodeFunctionData({
                  abi: RafflePrizeDistributorAbi,
                  functionName: "sponsorERC20",
                  args: [seasonId, tokenAddr, parsedAmount, tier],
                }),
              });
            } else {
              // ERC-721
              const nftTokenId = BigInt(prize.tokenId);
              calls.push({
                to: tokenAddr,
                data: encodeFunctionData({
                  abi: ERC721ApproveAbi,
                  functionName: "approve",
                  args: [distributorAddr, nftTokenId],
                }),
              });
              calls.push({
                to: distributorAddr,
                data: encodeFunctionData({
                  abi: RafflePrizeDistributorAbi,
                  functionName: "sponsorERC721",
                  args: [seasonId, tokenAddr, nftTokenId, tier],
                }),
              });
            }
          }

          if (calls.length > 0) {
            await executeBatch(calls);
          }

          // Handle offchain prizes via backend API
          const offchainPrizes = confirmedPrizes.filter(p => p.type === "offchain");
          for (const prize of offchainPrizes) {
            const res = await fetch(`/api/sponsor-prizes/${seasonId}/offchain`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chainId: prize.chainId,
                tokenAddress: prize.tokenAddress.trim(),
                tokenId: prize.tokenId || undefined,
                description: prize.description || undefined,
                sponsorAddress: address,
                targetTier: prize.targetTier,
                prizeType: prize.tokenId ? "erc721" : "erc20",
              }),
            });
            if (!res.ok) throw new Error(t("offchainPrizeFailed"));
          }

          if (!cancelled) setSponsorStatus("success");
        } catch (err) {
          if (!cancelled) {
            setSponsorStatus("error");
            setFormError(`Season created but failed to sponsor prizes: ${err.message}`);
          }
        }
      })();
    }

    // Reset form
    setStartTime("");
    setEndTime("");
    setSponsoredPrizes([]);
    if (confirmedPrizes.length === 0) setSponsorStatus("");
    confirmedDataRef.current = null;
    return () => { cancelled = true; };
  }, [createSeason?.isConfirmed, createSeason?.receipt, gated, gatingGates, addresses.SEASON_GATING, addresses.RAFFLE, writeGatingContract, publicClient, executeBatch, address, t]);

  // Tier helpers
  const totalWinnerCount = useMemo(() => tiers.reduce((sum, t) => sum + (t.winnerCount || 0), 0), [tiers]);

  const addTier = () => {
    if (tiers.length >= 5) return;
    setTiers([...tiers, { winnerCount: 1 }]);
  };

  const removeTier = (index) => {
    if (tiers.length <= 1) return;
    setTiers(tiers.filter((_, i) => i !== index));
  };

  const updateTierWinnerCount = (index, count) => {
    const updated = [...tiers];
    updated[index] = { ...updated[index], winnerCount: Math.max(1, Math.min(10, Number(count) || 1)) };
    setTiers(updated);
  };

  const getTierLabel = (index) => {
    if (index === 0) return t("tierGrandPrize");
    if (index === 1) return t("tierRunnerUp");
    if (index === 2) return t("tierThirdPlace");
    return t("tierLabel", { number: index + 1 });
  };

  // Sponsored prize helpers
  const addSponsoredPrize = () => {
    setSponsoredPrizes([...sponsoredPrizes, { type: "erc20", tokenAddress: "", amount: "", tokenId: "", targetTier: 0, description: "", chainId: 8453 }]);
  };

  const removeSponsoredPrize = (index) => {
    setSponsoredPrizes(sponsoredPrizes.filter((_, i) => i !== index));
  };

  const updateSponsoredPrize = (index, field, value) => {
    const updated = [...sponsoredPrizes];
    updated[index] = { ...updated[index], [field]: value };
    setSponsoredPrizes(updated);
  };

  const handleCreateSeason = async (e) => {
    e.preventDefault();
    setFormError("");
    setNameError("");
    setTreasuryError("");
    setGatingStatus("");

    // Validate name is not empty
    if (!name || name.trim().length === 0) {
      setNameError(t("seasonNameRequired"));
      setFormError(t("seasonNameRequired"));
      return;
    }

    // Validate treasury address
    if (!treasuryAddress || treasuryAddress.trim().length === 0) {
      setTreasuryError(t("treasuryRequired"));
      setFormError(t("treasuryRequired"));
      return;
    }
    if (!isAddress(treasuryAddress.trim())) {
      setTreasuryError(t("invalidAddress"));
      setFormError(t("invalidTreasuryAddress"));
      return;
    }

    let latestChainSec = null;
    if (publicClient) {
      try {
        const block = await publicClient.getBlock();
        latestChainSec = Number(block?.timestamp ?? null);
      } catch (err) {
        // Reason: on intermittent RPC failures we fall back to cached timestamp without surfacing noisy logs.
        latestChainSec = null;
      }
    }

    const chainNowSec =
      typeof latestChainSec === "number" && Number.isFinite(latestChainSec)
        ? latestChainSec
        : typeof chainTimeQuery.data === "number"
        ? chainTimeQuery.data
        : null;
    let manualStartSec = null;
    if (!startTime) {
      setFormError(t("startTimeRequired"));
      return;
    }
    const parsed = Math.floor(new Date(startTime).getTime() / 1000);
    if (!Number.isFinite(parsed)) {
      setFormError(t("invalidStartTime"));
      return;
    }
    manualStartSec = parsed;

    const start = manualStartSec;

    const effectiveChainTime =
      typeof chainNowSec === "number" && Number.isFinite(chainNowSec)
        ? chainNowSec
        : Math.floor(Date.now() / 1000);
    const secondsAhead = Number(start) - effectiveChainTime;
    // Enforce buffer window for start time
    if (secondsAhead <= AUTO_START_BUFFER_SECONDS) {
      const minStartSec = effectiveChainTime + AUTO_START_BUFFER_SECONDS + 5; // cushion 5s
      const adjusted = new Date(minStartSec * 1000).toISOString().slice(0, 16);
      setStartTime(adjusted);
      setFormError(
        t("startTimeTooSoon", { seconds: AUTO_START_BUFFER_SECONDS, adjusted })
      );
      return;
    }

    if (!endTime) {
      setFormError(t("endTimeRequired"));
      return;
    }

    const end = Math.floor(new Date(endTime).getTime() / 1000);
    if (!Number.isFinite(end)) {
      setFormError(t("invalidEndTime"));
      return;
    }
    if (end <= start) {
      setFormError(t("endAfterStart"));
      return;
    }
    // Validate grand prize percentage (UI only constraints 55% - 75%)
    const grandParsedPct = Number(grandPct);
    if (
      Number.isNaN(grandParsedPct) ||
      grandParsedPct < 55 ||
      grandParsedPct > 75
    ) {
      setFormError(t("grandPrizeRange"));
      return;
    }
    const grandPrizeBps = Math.round(grandParsedPct * 100); // convert % -> BPS
    // Validate total winners
    if (totalWinnerCount === 0 || totalWinnerCount > 10) {
      setFormError(t("tierValidation", { max: 10 }));
      return;
    }

    const config = {
      name,
      startTime: BigInt(start),
      endTime: BigInt(end),
      winnerCount: totalWinnerCount,
      grandPrizeBps,
      treasuryAddress: treasuryAddress.trim(),
      raffleToken: "0x0000000000000000000000000000000000000000",
      bondingCurve: "0x0000000000000000000000000000000000000000",
      sponsor: "0x0000000000000000000000000000000000000000", // Contract sets this to msg.sender
      isActive: false,
      isCompleted: false,
      gated,
    };

    // Validate bond steps from curve editor
    if (!curveData.isValid) {
      setFormError(t("curveInvalid"));
      return;
    }
    if (!curveData.steps || curveData.steps.length === 0) {
      setFormError(t("bondStepsRequired"));
      return;
    }

    // Convert curve editor steps to on-chain format
    const bondSteps = curveData.steps.map((s) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.priceScaled),
    }));

    setFormError("");
    const buyFeeBps = 10; // 0.10%
    const sellFeeBps = 70; // 0.70%

    // Build tier configs for contract (only if > 1 tier or tier 0 has > 1 winner)
    const tierConfigs = tiers.length > 1 || tiers[0].winnerCount > 1
      ? tiers.map((t) => ({ winnerCount: t.winnerCount }))
      : [];

    // Validate sponsored prizes
    for (const prize of sponsoredPrizes) {
      if (!isAddress(prize.tokenAddress.trim())) {
        setFormError(t("invalidAddress"));
        return;
      }
      if (prize.type === "erc20" && (!prize.amount || Number(prize.amount) <= 0)) {
        setFormError(t("amountMustBePositive"));
        return;
      }
      if (prize.type === "erc721") {
        if (!prize.tokenId || !/^\d+$/.test(prize.tokenId.trim())) {
          setFormError(t("tokenIdRequired"));
          return;
        }
      }
    }

    // Store data and show confirmation dialog instead of submitting immediately
    setPendingSubmitData({ config, bondSteps, buyFeeBps, sellFeeBps, tierConfigs, sponsoredPrizes });
    setShowConfirmation(true);
  };

  const handleConfirmCreate = () => {
    if (!pendingSubmitData) return;
    confirmedDataRef.current = pendingSubmitData;
    setShowConfirmation(false);
    createSeason.mutate(pendingSubmitData);
    setPendingSubmitData(null);
  };

  const handleCancelConfirmation = () => {
    setShowConfirmation(false);
    setPendingSubmitData(null);
  };

  // Helper to truncate an address for display
  const truncateAddress = (addr) => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Helper to format epoch seconds for confirmation display
  const formatConfirmationTime = (epochBigInt) => {
    const d = new Date(Number(epochBigInt) * 1000);
    return d.toLocaleString();
  };

  return (
    <form onSubmit={handleCreateSeason} className="space-y-4">
      {/* Show circuit breaker alert if error detected */}
      <MetaMaskCircuitBreakerAlert
        error={createSeason?.error}
        onDismiss={() => createSeason.reset()}
      />

      {/* ── Section 1: Main Details ───────────────────────────── */}
      {(activeSection === "all" || activeSection === "details") && (
        <div className="space-y-4">
          {/* Season Name */}
          <div className="space-y-1">
            <Input
              placeholder={t("seasonNamePlaceholder")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError("");
              }}
              required
              className={nameError ? "border-destructive" : ""}
              aria-invalid={nameError ? "true" : "false"}
              aria-describedby={nameError ? "name-error" : undefined}
            />
            {nameError && (
              <p id="name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>

          {/* Season Timing */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("seasonTiming")}</label>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("startTime")}</label>
                <DateTimePicker
                  value={startTime}
                  onChange={setStartTime}
                  label={t("startTime")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("endTime")}</label>
                <DateTimePicker
                  value={endTime}
                  onChange={setEndTime}
                  label={t("endTime")}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetToDefaultDates}
                className="flex items-center gap-1 h-9"
              >
                <CalendarIcon className="h-4 w-4" />
                {t("reset")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("timingHelp", { seconds: AUTO_START_BUFFER_SECONDS })}
            </p>
          </div>

          {/* Participation Requirements (Gating) */}
          <GatingConfig
            gated={gated}
            onGatedChange={setGated}
            onGatesChange={setGatingGates}
          />
        </div>
      )}

      {/* ── Section 2: Prize Settings ────────────────────────── */}
      {(activeSection === "all" || activeSection === "prizes") && (
        <div className="space-y-4">
          {/* Treasury Wallet */}
          <div className="space-y-1">
            <label className="text-sm">{t("treasuryWallet")}</label>
            <Input
              placeholder="0x..."
              value={treasuryAddress}
              onChange={(e) => {
                setTreasuryAddress(e.target.value);
                if (treasuryError) setTreasuryError("");
              }}
              required
              className={treasuryError ? "border-destructive" : ""}
              aria-invalid={treasuryError ? "true" : "false"}
              aria-describedby={treasuryError ? "treasury-error" : undefined}
            />
            {treasuryError && (
              <p id="treasury-error" className="text-xs text-destructive">
                {treasuryError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("treasuryHelp")}
            </p>
          </div>

          {/* Grand Prize Split */}
          <div>
            <label className="text-sm">{t("grandPrizeSplit")}</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={55}
                max={75}
                step={1}
                value={grandPct}
                onChange={(e) => setGrandPct(e.target.value)}
                className="w-full"
              />
              <span className="w-12 text-right text-sm font-mono">
                {grandPct}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("grandPrizeHelp")}
            </p>
          </div>

          {/* Prize Tiers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">{t("tierConfigTitle")}</label>
                <p className="text-xs text-muted-foreground">{t("tierConfigHelp")}</p>
              </div>
              {tiers.length < 5 && (
                <Button type="button" variant="outline" size="sm" onClick={addTier} className="flex items-center gap-1">
                  <Plus className="h-3 w-3" />
                  {t("addTier")}
                </Button>
              )}
            </div>

            {tiers.map((tier, index) => (
              <div key={index} className="flex items-center gap-3 p-2 border border-border rounded-lg">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Gift className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{getTierLabel(index)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t("tierWinnerCount")}</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={tier.winnerCount}
                    onChange={(e) => updateTierWinnerCount(index, e.target.value)}
                    className="w-16 h-8 text-center"
                  />
                </div>
                {tiers.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeTier(index)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}

            <p className="text-xs text-muted-foreground">
              {t("tierTotalWinners", { count: totalWinnerCount })}
              {totalWinnerCount > 10 && (
                <span className="text-destructive ml-1">{t("tierValidation", { max: 10 })}</span>
              )}
            </p>
          </div>

        </div>
      )}

      {/* ── Section 3: Bonding Curve ─────────────────────────── */}
      {(activeSection === "all" || activeSection === "curve") && (
        <BondingCurveEditor
          onChange={handleCurveChange}
          sofDecimals={sofDecimals}
        />
      )}

      {/* ── Section 4: Sponsored Prizes ──────────────────────── */}
      {(activeSection === "all" || activeSection === "sponsored") && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">{t("sponsoredPrizeLabel")}</label>
              <p className="text-xs text-muted-foreground">{t("sponsoredPrizeHelp")}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addSponsoredPrize} className="flex items-center gap-1">
              <Plus className="h-3 w-3" />
              {t("addTier")}
            </Button>
          </div>

          {sponsoredPrizes.length === 0 && (
            <div className="p-4 border border-dashed border-border rounded-lg text-center">
              <Gift className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">{t("noSponsoredPrizes")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("defaultTierHelp")}</p>
            </div>
          )}

          {sponsoredPrizes.map((prize, index) => (
            <div key={index} className="p-3 border border-border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t("sponsoredPrizeLabel")} #{index + 1}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeSponsoredPrize(index)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Type selector */}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={prize.type === "erc20" ? "default" : "outline"} onClick={() => updateSponsoredPrize(index, "type", "erc20")}>
                  {t("sponsorPrizeERC20")}
                </Button>
                <Button type="button" size="sm" variant={prize.type === "erc721" ? "default" : "outline"} onClick={() => updateSponsoredPrize(index, "type", "erc721")}>
                  {t("sponsorPrizeERC721")}
                </Button>
                <Button type="button" size="sm" variant={prize.type === "offchain" ? "default" : "outline"} onClick={() => updateSponsoredPrize(index, "type", "offchain")}>
                  {t("sponsorPrizeOffchain")}
                </Button>
              </div>

              {/* Token address */}
              <Input
                placeholder={t("sponsorTokenAddress")}
                value={prize.tokenAddress}
                onChange={(e) => updateSponsoredPrize(index, "tokenAddress", e.target.value)}
              />

              {/* Amount for ERC-20 */}
              {prize.type === "erc20" && (
                <Input
                  type="number"
                  placeholder={t("sponsorAmount")}
                  value={prize.amount}
                  onChange={(e) => updateSponsoredPrize(index, "amount", e.target.value)}
                />
              )}

              {/* Token ID for ERC-721 */}
              {prize.type === "erc721" && (
                <Input
                  placeholder={t("sponsorTokenId")}
                  value={prize.tokenId}
                  onChange={(e) => updateSponsoredPrize(index, "tokenId", e.target.value)}
                />
              )}

              {/* Offchain fields */}
              {prize.type === "offchain" && (
                <>
                  <Input
                    placeholder={t("sponsorTokenId")}
                    value={prize.tokenId}
                    onChange={(e) => updateSponsoredPrize(index, "tokenId", e.target.value)}
                  />
                  <Input
                    placeholder={t("sponsorDescription")}
                    value={prize.description}
                    onChange={(e) => updateSponsoredPrize(index, "description", e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">{t("sponsorChain")}</label>
                    <select
                      value={prize.chainId}
                      onChange={(e) => updateSponsoredPrize(index, "chainId", Number(e.target.value))}
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
              {tiers.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t("sponsorTargetTier")}</label>
                  <select
                    value={prize.targetTier}
                    onChange={(e) => updateSponsoredPrize(index, "targetTier", Number(e.target.value))}
                    className="text-sm border border-border rounded px-2 py-1 bg-background"
                  >
                    {tiers.map((_, tierIdx) => (
                      <option key={tierIdx} value={tierIdx}>{getTierLabel(tierIdx)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Form-level errors & submit — on sponsored step, curve step, or "all" */}
      {(activeSection === "all" || activeSection === "sponsored" || activeSection === "curve") && (
        <>
          {formError && (
            <p className="text-xs text-destructive">{formError}</p>
          )}
          {startTooSoonUi && (
            <p className="text-xs text-warning mb-1">
              {t("startTimeTooSoonWarning", { seconds: AUTO_START_BUFFER_SECONDS })}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={createSeason?.isPending || startTooSoonUi || !name || name.trim().length === 0 || !treasuryAddress || !isAddress(treasuryAddress.trim()) || !curveData.isValid || totalWinnerCount === 0 || totalWinnerCount > 10}
          >
            {createSeason?.isPending ? t("creatingBtn") : t("createSeasonBtn")}
          </Button>
          <TransactionModal mutation={createSeason} title={t("creatingSeasonTitle")} />
          {gatingStatus === "pending" && (
            <p className="text-xs text-warning">{t("configuringGates")}</p>
          )}
          {gatingStatus === "success" && (
            <p className="text-xs text-success">{t("gatesConfigured")}</p>
          )}
          {gatingStatus === "error" && (
            <p className="text-xs text-destructive">{t("gatesConfigFailed")}</p>
          )}
          {sponsorStatus === "pending" && (
            <p className="text-xs text-warning">{t("sponsoring")}</p>
          )}
          {sponsorStatus === "success" && (
            <p className="text-xs text-success flex items-center gap-1">{t("sponsoredPrizes")} <Check className="h-3 w-3" /></p>
          )}
          {sponsorStatus === "error" && (
            <p className="text-xs text-destructive">{formError}</p>
          )}
        </>
      )}
      {/* Confirmation Dialog */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmSeasonTitle")}</DialogTitle>
          </DialogHeader>
          {pendingSubmitData && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmSeasonName")}</span>
                <span className="font-medium">{pendingSubmitData.config.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmStartTime")}</span>
                <span className="font-medium">{formatConfirmationTime(pendingSubmitData.config.startTime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmEndTime")}</span>
                <span className="font-medium">{formatConfirmationTime(pendingSubmitData.config.endTime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmWinnerCount")}</span>
                <span className="font-medium">{pendingSubmitData.config.winnerCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmGrandPrize")}</span>
                <span className="font-medium">{pendingSubmitData.config.grandPrizeBps / 100}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmTreasury")}</span>
                <span className="font-medium font-mono">{truncateAddress(pendingSubmitData.config.treasuryAddress)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmBondSteps")}</span>
                <span className="font-medium">{pendingSubmitData.bondSteps.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmBuyFee")}</span>
                <span className="font-medium">{pendingSubmitData.buyFeeBps / 100}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmSellFee")}</span>
                <span className="font-medium">{pendingSubmitData.sellFeeBps / 100}%</span>
              </div>
              {pendingSubmitData.tierConfigs && pendingSubmitData.tierConfigs.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("confirmTiers")}</span>
                  <span className="font-medium">
                    {pendingSubmitData.tierConfigs.map((tc, i) => `${getTierLabel(i)}: ${tc.winnerCount}`).join(", ")}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmGated")}</span>
                <span className="font-medium">
                  {pendingSubmitData.config.gated ? t("confirmYes") : t("confirmNo")}
                </span>
              </div>
              {pendingSubmitData.config.gated && gatingGates.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("confirmGateType")}</span>
                  <span className="font-medium">
                    {gatingGates.map((g) => g.gateType).join(", ")}
                  </span>
                </div>
              )}
              {pendingSubmitData.sponsoredPrizes && pendingSubmitData.sponsoredPrizes.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("sponsoredPrizeLabel")}</span>
                  <span className="font-medium">
                    {t("sponsoredPrizeCount", { count: pendingSubmitData.sponsoredPrizes.length })}
                  </span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="cancel" onClick={handleCancelConfirmation}>
              {t("confirmCancelBtn")}
            </Button>
            <Button type="button" onClick={handleConfirmCreate}>
              {t("confirmSignBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
};

CreateSeasonForm.propTypes = {
  createSeason: PropTypes.object.isRequired,
  chainTimeQuery: PropTypes.object.isRequired,
  activeSection: PropTypes.oneOf(["all", "details", "prizes", "curve", "sponsored"]),
};

export default CreateSeasonForm;
