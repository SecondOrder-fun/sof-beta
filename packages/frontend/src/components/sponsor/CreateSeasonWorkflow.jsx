// src/components/sponsor/CreateSeasonWorkflow.jsx
// Two-panel create-season flow:
//   Panel 1: SponsorStakingCard (stake/unstake management)
//   Panel 2: 5-step workflow (Details → Prizes → Curve → Sponsored Prizes → Done)
// "Back" on Details returns to the sponsor panel so users can unstake.
import { useState, useEffect, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useChainTime } from "@/hooks/useChainTime";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { decodeEventLog } from "viem";
import { ChevronLeft, ChevronRight, Crown, ExternalLink, Loader2 } from "lucide-react";
import PropTypes from "prop-types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
// Sponsored prizes are now collected inline in CreateSeasonForm step 4
import { Button } from "@/components/ui/button";
import {
  Workflow,
  WorkflowSteps,
  WorkflowStep,
  WorkflowContent,
  useWorkflow,
} from "@/components/ui/workflow";
import { SponsorStakingCard } from "@/components/sponsor/SponsorStakingCard";
import CreateSeasonForm from "@/components/admin/CreateSeasonForm";
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useSponsorStaking } from "@/hooks/useSponsorStaking";
import { useRaffleWrite } from "@/hooks/useRaffleWrite";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses, RAFFLE_ABI } from "@/config/contracts";

/**
 * Inner component — requires AdminAuthProvider above it.
 * Manages the sponsor panel ↔ creation workflow toggle.
 */
function WorkflowInner() {
  const { t } = useTranslation("raffle");
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const publicClient = usePublicClient();
  const { isAuthenticated, isLoading: isAuthLoading, error: authError, login } = useAdminAuth();
  const { isSponsor, isLoading: isSponsorLoading } = useSponsorStaking();
  const { createSeason } = useRaffleWrite();

  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  // Check on-chain canCreateSeason
  const { isLoading: isCanCreateLoading } = useQuery({
    queryKey: ["canCreateSeason", address, contracts.RAFFLE],
    queryFn: async () => {
      if (!publicClient || !contracts.RAFFLE) return false;
      try {
        return await publicClient.readContract({
          address: contracts.RAFFLE,
          abi: [{
            type: "function",
            name: "canCreateSeason",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "view",
          }],
          functionName: "canCreateSeason",
          args: [address],
        });
      } catch {
        return false;
      }
    },
    enabled: !!address && !!publicClient,
  });

  const chainNow = useChainTime({ refetchInterval: 10_000 });
  const chainTimeQuery = { data: chainNow };

  // Two views: "sponsor" (staking panel) or "create" (4-step workflow)
  const [view, setView] = useState(isSponsor ? "create" : "sponsor");
  const [currentStep, setCurrentStep] = useState("details");
  const [createdSeasonId, setCreatedSeasonId] = useState(null);

  // When sponsor status resolves and user is already a sponsor, show creation view
  useEffect(() => {
    if (!isSponsorLoading && isSponsor && view === "sponsor") {
      setView("create");
    }
  }, [isSponsor, isSponsorLoading, view]);

  // Watch for season creation success
  useEffect(() => {
    if (!createSeason?.isConfirmed || !createSeason?.receipt) return;
    const seasonLog = createSeason.receipt.logs.find((log) => {
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
    if (seasonLog) {
      const decoded = decodeEventLog({
        abi: RAFFLE_ABI,
        data: seasonLog.data,
        topics: seasonLog.topics,
      });
      setCreatedSeasonId(Number(decoded.args.seasonId));
      setCurrentStep("confirm");
    }
  }, [createSeason?.isConfirmed, createSeason?.receipt]);

  const handleStepChange = useCallback((newStep) => {
    setCurrentStep(newStep);
  }, []);

  // "Back" on the Details step swaps to the sponsor panel
  const handleBackToSponsor = useCallback(() => {
    setView("sponsor");
  }, []);

  // "Create Season" on sponsor panel swaps to the creation workflow
  const handleStartCreation = useCallback(() => {
    setCurrentStep("details");
    setView("create");
  }, []);

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            {t("createRaffleTitle")}
          </CardTitle>
          <CardDescription>{t("connectToCreate")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isSponsorLoading || isCanCreateLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-muted-foreground">{t("checkingPermissions")}</span>
        </CardContent>
      </Card>
    );
  }

  /* ── Sponsor Panel ── */
  if (view === "sponsor") {
    return (
      <div className="space-y-4">
        <SponsorStakingCard />
        {isSponsor && (
          <Button onClick={handleStartCreation} className="w-full gap-2">
            <Crown className="h-4 w-4" />
            {t("nextConfigureSeason")}
          </Button>
        )}
      </div>
    );
  }

  /* ── Creation Workflow (5 steps) ── */
  const formSection = { details: "details", prizes: "prizes", curve: "curve", sponsored: "sponsored" }[currentStep] || null;
  const isFormStep = !!formSection;

  return (
    <Workflow value={currentStep} onValueChange={handleStepChange}>
      <WorkflowSteps className="mx-auto">
        <WorkflowStep value="details" label={t("sectionMainDetails")} stepNumber={1} />
        <WorkflowStep value="prizes" label={t("sectionPrizeSettings")} stepNumber={2} />
        <WorkflowStep value="curve" label={t("sectionBondingCurve")} stepNumber={3} />
        <WorkflowStep value="sponsored" label={t("sponsoredPrizeLabel")} stepNumber={4} />
        <WorkflowStep value="confirm" label={t("stepDone")} stepNumber={5} />
      </WorkflowSteps>

      {/* Steps 1-4: Form sections — auth gate or section content */}
      {["details", "prizes", "curve", "sponsored"].map((step) => (
        <WorkflowContent key={step} value={step}>
          {!isAuthenticated ? (
            <Card>
              <CardContent className="pt-6 flex flex-col items-center gap-4">
                <p className="text-muted-foreground text-center">
                  {t("signToCreate")}
                </p>
                <Button onClick={login} disabled={isAuthLoading} size="lg">
                  {isAuthLoading ? t("signing") : t("signInToCreate")}
                </Button>
                {authError && (
                  <p className="text-sm text-destructive">{authError}</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </WorkflowContent>
      ))}

      {/* Persistent form — rendered once, always mounted while on a form step */}
      {isFormStep && isAuthenticated && (
        <Card>
          <CardContent className="pt-6">
            <CreateSeasonForm
              createSeason={createSeason}
              chainTimeQuery={chainTimeQuery}
              activeSection={formSection}
            />
          </CardContent>
        </Card>
      )}

      {/* Back / Next nav for form steps */}
      {isFormStep && (
        <FormStepNav
          step={currentStep}
          isAuthenticated={isAuthenticated}
          showNext={currentStep !== "sponsored"}
          onBackToSponsor={currentStep === "details" ? handleBackToSponsor : undefined}
        />
      )}

      {/* Step 4: Confirmation */}
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
            <Button
              onClick={() => navigate(`/raffles/${createdSeasonId}`)}
              className="mt-2"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {t("viewSeason")}
            </Button>
          </CardContent>
        </Card>

      </WorkflowContent>
    </Workflow>
  );
}

/**
 * Navigation for form steps — Back / Next buttons.
 * On the Details step, Back returns to the sponsor panel (onBackToSponsor).
 * On other steps, Back goes to the previous workflow step.
 */
function FormStepNav({ step, isAuthenticated, showNext = true, onBackToSponsor }) {
  const { goBack, goNext, markCompleted } = useWorkflow();

  const handleNext = useCallback(() => {
    markCompleted(step);
    goNext();
  }, [markCompleted, goNext, step]);

  const handleBack = onBackToSponsor || goBack;

  return (
    <div className="flex justify-between mt-4">
      <Button variant="outline" onClick={handleBack} type="button">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {showNext && (
        <Button onClick={handleNext} disabled={!isAuthenticated} type="button">
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

FormStepNav.propTypes = {
  step: PropTypes.string.isRequired,
  isAuthenticated: PropTypes.bool,
  showNext: PropTypes.bool,
  onBackToSponsor: PropTypes.func,
};

/**
 * Public component — wraps with AdminAuthProvider.
 */
export function CreateSeasonWorkflow() {
  return (
    <AdminAuthProvider>
      <WorkflowInner />
    </AdminAuthProvider>
  );
}

export default CreateSeasonWorkflow;
