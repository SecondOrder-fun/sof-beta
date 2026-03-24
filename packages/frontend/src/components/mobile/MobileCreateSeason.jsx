// src/components/mobile/MobileCreateSeason.jsx
// Mobile-optimized 3-step create-season flow with curve presets.
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { isAddress, decodeEventLog } from "viem";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Crown, Loader2, ExternalLink, ChevronLeft } from "lucide-react";
import PropTypes from "prop-types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Workflow,
  WorkflowSteps,
  WorkflowStep,
  WorkflowContent,
  useWorkflow,
} from "@/components/ui/workflow";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useSponsorStaking } from "@/hooks/useSponsorStaking";
import { useRaffleWrite } from "@/hooks/useRaffleWrite";
import { useChainTime } from "@/hooks/useChainTime";
import { useSafeArea } from "@/hooks/useSafeArea";
import { RAFFLE_ABI } from "@/config/contracts";
import { AUTO_START_BUFFER_SECONDS } from "@/lib/seasonTime";
import { CURVE_PRESETS } from "@/lib/curvePresets";
import { generateLinearSteps } from "@/components/admin/BondingCurveEditor/useCurveEditor";

// Default timing
const DEFAULT_START_OFFSET_SECONDS = 5 * 60;
const DEFAULT_DURATION_SECONDS = 7 * 24 * 60 * 60;

const fmtLocalDatetime = (sec) => {
  const d = new Date(sec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Curve preset selector — radio card UI.
 */
function CurvePresetSelector({ selected, onSelect }) {
  const { t } = useTranslation("raffle");

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{t("curvePreset")}</label>
      <div className="space-y-2">
        {CURVE_PRESETS.map((preset) => {
          const isSelected = selected === preset.id;
          const minPrice = preset.basePrice;
          const maxPrice = preset.basePrice + (preset.numSteps - 1) * preset.priceDelta;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset.id)}
              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-muted-foreground/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-foreground">
                  {t(preset.labelKey)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {minPrice}–{maxPrice} SOF
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t(preset.descKey, {
                  steps: preset.numSteps,
                  tickets: (preset.maxTickets / 1000).toFixed(0) + "K",
                })}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

CurvePresetSelector.propTypes = {
  selected: PropTypes.string.isRequired,
  onSelect: PropTypes.func.isRequired,
};

/**
 * Inner workflow — requires AdminAuthProvider above.
 */
function MobileCreateSeasonInner() {
  const { t } = useTranslation("raffle");
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { isAuthenticated, isLoading: isAuthLoading, error: authError, login } = useAdminAuth();
  const { isSponsor, isLoading: isSponsorLoading } = useSponsorStaking();
  const { createSeason } = useRaffleWrite();
  const safeArea = useSafeArea();

  const chainNow = useChainTime({ refetchInterval: 10_000 });

  // Form state
  const [currentStep, setCurrentStep] = useState("details");
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [treasuryAddress, setTreasuryAddress] = useState(address || "");
  const [grandPct, setGrandPct] = useState("65");
  const [curvePreset, setCurvePreset] = useState("standard");
  const [formError, setFormError] = useState("");
  const [createdSeasonId, setCreatedSeasonId] = useState(null);

  // Default treasury to connected wallet
  useEffect(() => {
    if (address && !treasuryAddress) {
      setTreasuryAddress(address);
    }
  }, [address, treasuryAddress]);

  // Set initial start time
  useEffect(() => {
    if (startTime) return;
    const nowSec = typeof chainNow === "number" ? chainNow : Math.floor(Date.now() / 1000);
    setStartTime(fmtLocalDatetime(nowSec + DEFAULT_START_OFFSET_SECONDS));
  }, [startTime, chainNow]);

  // Auto-set end time
  useEffect(() => {
    if (!startTime || endTime) return;
    const startSec = Math.floor(new Date(startTime).getTime() / 1000);
    if (Number.isFinite(startSec)) {
      setEndTime(fmtLocalDatetime(startSec + DEFAULT_DURATION_SECONDS));
    }
  }, [startTime, endTime]);

  // Watch for season creation success
  useEffect(() => {
    if (!createSeason?.isConfirmed || !createSeason?.receipt) return;
    const seasonLog = createSeason.receipt.logs.find((log) => {
      try {
        const decoded = decodeEventLog({ abi: RAFFLE_ABI, data: log.data, topics: log.topics });
        return decoded.eventName === "SeasonCreated";
      } catch {
        return false;
      }
    });
    if (seasonLog) {
      const decoded = decodeEventLog({ abi: RAFFLE_ABI, data: seasonLog.data, topics: seasonLog.topics });
      setCreatedSeasonId(Number(decoded.args.seasonId));
      setCurrentStep("confirm");
    }
  }, [createSeason?.isConfirmed, createSeason?.receipt]);

  // Validation for step 1
  const step1Valid = useMemo(() => {
    if (!name || name.trim().length === 0) return false;
    if (!startTime || !endTime) return false;
    const startSec = Math.floor(new Date(startTime).getTime() / 1000);
    const endSec = Math.floor(new Date(endTime).getTime() / 1000);
    return Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec;
  }, [name, startTime, endTime]);

  // Validation for step 2
  const step2Valid = useMemo(() => {
    if (!treasuryAddress || !isAddress(treasuryAddress.trim())) return false;
    const pct = Number(grandPct);
    return !Number.isNaN(pct) && pct >= 55 && pct <= 75;
  }, [treasuryAddress, grandPct]);

  // Generate steps from preset
  const selectedPreset = CURVE_PRESETS.find((p) => p.id === curvePreset) || CURVE_PRESETS[0];
  const generatedSteps = useMemo(
    () => generateLinearSteps(selectedPreset.maxTickets, selectedPreset.numSteps, selectedPreset.basePrice, selectedPreset.priceDelta, 18),
    [selectedPreset],
  );

  const handleSubmit = useCallback(async () => {
    setFormError("");

    // Validate start time against chain
    const startSec = Math.floor(new Date(startTime).getTime() / 1000);
    const endSec = Math.floor(new Date(endTime).getTime() / 1000);
    const effectiveChainTime = typeof chainNow === "number" ? chainNow : Math.floor(Date.now() / 1000);

    if (startSec - effectiveChainTime <= AUTO_START_BUFFER_SECONDS) {
      setFormError(t("startTimeTooSoon", { seconds: AUTO_START_BUFFER_SECONDS, adjusted: "" }));
      return;
    }

    const grandPrizeBps = Math.round(Number(grandPct) * 100);

    const config = {
      name,
      startTime: BigInt(startSec),
      endTime: BigInt(endSec),
      winnerCount: 1,
      grandPrizeBps,
      treasuryAddress: treasuryAddress.trim(),
      raffleToken: "0x0000000000000000000000000000000000000000",
      bondingCurve: "0x0000000000000000000000000000000000000000",
      sponsor: "0x0000000000000000000000000000000000000000",
      isActive: false,
      isCompleted: false,
      gated: false,
    };

    const bondSteps = generatedSteps.map((s) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.priceScaled),
    }));

    const buyFeeBps = 10;
    const sellFeeBps = 70;
    createSeason.mutate({ config, bondSteps, buyFeeBps, sellFeeBps });
  }, [name, startTime, endTime, treasuryAddress, grandPct, generatedSteps, chainNow, createSeason, t]);

  // Handle mutation error
  useEffect(() => {
    if (createSeason?.isError && createSeason?.error) {
      setFormError(createSeason.error.message);
    }
  }, [createSeason?.isError, createSeason?.error]);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center gap-4">
        <Crown className="h-8 w-8 text-primary" />
        <p className="text-muted-foreground">{t("connectToCreate")}</p>
      </div>
    );
  }

  if (isSponsorLoading) {
    return (
      <div className="flex items-center justify-center p-6 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-muted-foreground">{t("checkingPermissions")}</span>
      </div>
    );
  }

  if (!isSponsor) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center gap-4">
        <Crown className="h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground">{t("notSponsorMobile")}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t("common:back")}
        </Button>
      </div>
    );
  }

  // Auth gate
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center gap-4">
        <Crown className="h-8 w-8 text-primary" />
        <p className="text-muted-foreground">{t("signToCreate")}</p>
        <Button onClick={login} disabled={isAuthLoading} size="lg">
          {isAuthLoading ? t("signing") : t("signInToCreate")}
        </Button>
        {authError && <p className="text-sm text-destructive">{authError}</p>}
      </div>
    );
  }

  return (
    <div className="px-3 pt-2" style={{ paddingBottom: safeArea.bottom + 16 }}>
      <Workflow value={currentStep} onValueChange={setCurrentStep}>
        <WorkflowSteps className="mx-auto mb-8">
          <WorkflowStep value="details" label={t("sectionMainDetails")} stepNumber={1} />
          <WorkflowStep value="prizes" label={t("sectionPrizeSettings")} stepNumber={2} />
          <WorkflowStep value="confirm" label={t("stepDone")} stepNumber={3} />
        </WorkflowSteps>

        {/* Step 1: Details */}
        <WorkflowContent value="details">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("seasonNamePlaceholder")}</label>
                <Input
                  placeholder={t("seasonNamePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("startTime")}</label>
                <DateTimePicker
                  value={startTime}
                  onChange={setStartTime}
                  label={t("startTime")}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("endTime")}</label>
                <DateTimePicker
                  value={endTime}
                  onChange={setEndTime}
                  label={t("endTime")}
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>
          <Step1Nav canProceed={step1Valid} />
        </WorkflowContent>

        {/* Step 2: Prizes & Curve */}
        <WorkflowContent value="prizes">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("treasuryWallet")}</label>
                <Input
                  placeholder="0x..."
                  value={treasuryAddress}
                  onChange={(e) => setTreasuryAddress(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("treasuryHelp")}</p>
              </div>

              <div>
                <label className="text-sm font-medium">{t("grandPrizeSplit")}</label>
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
                  <span className="w-12 text-right text-sm font-mono">{grandPct}%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t("grandPrizeHelp")}</p>
              </div>

              <CurvePresetSelector selected={curvePreset} onSelect={setCurvePreset} />
            </CardContent>
          </Card>
          <Step2Nav canProceed={step2Valid} onSubmit={handleSubmit} isSubmitting={createSeason?.isPending} />
          {formError && <p className="text-xs text-destructive mt-2 px-1">{formError}</p>}
        </WorkflowContent>

        {/* Step 3: Confirmation */}
        <WorkflowContent value="confirm">
          <Card>
            <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Crown className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold">{t("seasonCreated")}</h3>
              <p className="text-muted-foreground">
                {t("seasonCreatedMessage", { seasonId: createdSeasonId })}
              </p>
              <Button onClick={() => navigate(`/raffles/${createdSeasonId}`)} className="mt-2">
                <ExternalLink className="h-4 w-4 mr-2" />
                {t("viewSeason")}
              </Button>
            </CardContent>
          </Card>
        </WorkflowContent>
      </Workflow>
    </div>
  );
}

/**
 * Step 1 nav — marks step completed and advances.
 */
function Step1Nav({ canProceed }) {
  const { goNext, markCompleted } = useWorkflow();

  const handleNext = useCallback(() => {
    markCompleted("details");
    goNext();
  }, [markCompleted, goNext]);

  return (
    <div className="flex justify-end mt-4">
      <Button onClick={handleNext} disabled={!canProceed} type="button">
        {useTranslation("common").t("next")}
      </Button>
    </div>
  );
}

Step1Nav.propTypes = {
  canProceed: PropTypes.bool.isRequired,
};

/**
 * Step 2 nav — Back + Submit.
 */
function Step2Nav({ canProceed, onSubmit, isSubmitting }) {
  const { t } = useTranslation("raffle");
  const { goBack, markCompleted } = useWorkflow();

  const handleSubmit = useCallback(() => {
    markCompleted("prizes");
    onSubmit();
  }, [markCompleted, onSubmit]);

  return (
    <div className="flex justify-between mt-4">
      <Button variant="outline" onClick={goBack} type="button">
        <ChevronLeft className="h-4 w-4 mr-1" />
        {useTranslation("common").t("back")}
      </Button>
      <Button onClick={handleSubmit} disabled={!canProceed || isSubmitting} type="button">
        {isSubmitting ? t("creatingBtn") : t("createSeasonBtn")}
      </Button>
    </div>
  );
}

Step2Nav.propTypes = {
  canProceed: PropTypes.bool.isRequired,
  onSubmit: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool,
};

/**
 * Public component — wraps with AdminAuthProvider.
 */
const MobileCreateSeason = () => {
  return (
    <AdminAuthProvider>
      <MobileCreateSeasonInner />
    </AdminAuthProvider>
  );
};

export default MobileCreateSeason;
