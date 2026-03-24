// src/components/ui/workflow.jsx
// Workflow stepper component with step connectors and animated content.
// Built on top of Tabs/TabsContent animation system.
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import PropTypes from "prop-types";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ── Context ───────────────────────────────────────────────────────────
const WorkflowContext = React.createContext(null);

function useWorkflow() {
  const ctx = React.useContext(WorkflowContext);
  if (!ctx) throw new Error("Workflow.* must be used inside <Workflow />");
  return ctx;
}

// ── Spring config (matches tabs.jsx) ──────────────────────────────────
const SPRING = { type: "spring", stiffness: 300, damping: 24, mass: 0.8 };
const SLIDE_DISTANCE = 50;

// ── Root ──────────────────────────────────────────────────────────────
const Workflow = ({ value, onValueChange, children, className }) => {
  const stepOrderRef = React.useRef([]);
  const [completedSteps, setCompletedSteps] = React.useState(new Set());
  const [direction, setDirection] = React.useState(1);

  const registerStep = React.useCallback((val) => {
    stepOrderRef.current = [...new Set([...stepOrderRef.current, val])];
  }, []);

  const markCompleted = React.useCallback((stepValue) => {
    setCompletedSteps((prev) => new Set([...prev, stepValue]));
  }, []);

  const goTo = React.useCallback(
    (newValue) => {
      const order = stepOrderRef.current;
      const oldIdx = order.indexOf(value);
      const newIdx = order.indexOf(newValue);
      if (newIdx < 0) return;
      // Can only go forward to the next uncompleted step, or backward freely
      if (newIdx > oldIdx + 1) {
        // Check all intermediate steps are completed
        for (let i = oldIdx; i < newIdx; i++) {
          if (!completedSteps.has(order[i])) return;
        }
      }
      setDirection(newIdx >= oldIdx ? 1 : -1);
      onValueChange(newValue);
    },
    [value, onValueChange, completedSteps],
  );

  const goNext = React.useCallback(() => {
    const order = stepOrderRef.current;
    const idx = order.indexOf(value);
    if (idx < order.length - 1) {
      setDirection(1);
      onValueChange(order[idx + 1]);
    }
  }, [value, onValueChange]);

  const goBack = React.useCallback(() => {
    const order = stepOrderRef.current;
    const idx = order.indexOf(value);
    if (idx > 0) {
      setDirection(-1);
      onValueChange(order[idx - 1]);
    }
  }, [value, onValueChange]);

  const isFirstStep = stepOrderRef.current.indexOf(value) === 0;
  const isLastStep =
    stepOrderRef.current.indexOf(value) === stepOrderRef.current.length - 1;

  const ctx = React.useMemo(
    () => ({
      activeValue: value,
      direction,
      completedSteps,
      stepOrder: stepOrderRef.current,
      registerStep,
      markCompleted,
      goTo,
      goNext,
      goBack,
      isFirstStep,
      isLastStep,
    }),
    [value, direction, completedSteps, registerStep, markCompleted, goTo, goNext, goBack, isFirstStep, isLastStep],
  );

  return (
    <WorkflowContext.Provider value={ctx}>
      <TabsPrimitive.Root
        value={value}
        onValueChange={goTo}
        className={cn("w-full", className)}
      >
        {children}
      </TabsPrimitive.Root>
    </WorkflowContext.Provider>
  );
};

Workflow.propTypes = {
  value: PropTypes.string.isRequired,
  onValueChange: PropTypes.func.isRequired,
  children: PropTypes.node,
  className: PropTypes.string,
};

// ── Steps (header with circles + connectors) ─────────────────────────
// Bottom margin accounts for the absolutely-positioned labels below icons.
const WorkflowSteps = ({ children, className }) => {
  return (
    <TabsPrimitive.List
      className={cn("flex items-center w-full mb-12 flex-shrink-0", className)}
    >
      {children}
    </TabsPrimitive.List>
  );
};

WorkflowSteps.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string,
};

// ── Single Step (circle + label + connector) ─────────────────────────
// The trigger is sized to the icon only (w-8). The label is absolutely
// positioned below, so it never affects horizontal distribution or
// connector alignment.
const WorkflowStep = ({ value, label, stepNumber }) => {
  const { activeValue, completedSteps, registerStep, stepOrder } = useWorkflow();

  React.useEffect(() => {
    registerStep(value);
  }, [value, registerStep]);

  const isActive = activeValue === value;
  const isCompleted = completedSteps.has(value);
  const activeIdx = stepOrder.indexOf(activeValue);
  const myIdx = stepOrder.indexOf(value);
  const isPast = myIdx < activeIdx;
  const isClickable = isActive || isCompleted || isPast;

  // Show connector line BEFORE this step (except the first one)
  const showConnector = myIdx > 0;
  const connectorFilled = isPast || isActive;

  return (
    <>
      {/* Connector line — flex-1 fills space between fixed-width icon triggers */}
      {showConnector && (
        <div className="flex-1 mx-2 h-1.5 rounded-full bg-border relative overflow-hidden">
          <motion.div
            className="absolute inset-0 rounded-full bg-primary origin-left"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: connectorFilled ? 1 : 0 }}
            transition={SPRING}
          />
        </div>
      )}

      {/* Step icon (fixed w-9) + absolutely-positioned label.
          asChild avoids the global button styles in tailwind.css */}
      <TabsPrimitive.Trigger value={value} disabled={!isClickable} asChild>
        <span
          role="button"
          tabIndex={isClickable ? 0 : -1}
          className="relative inline-flex items-center justify-center w-9 shrink-0 cursor-pointer [&[data-disabled]]:cursor-default"
        >
        {/* Highlight ring — circular glow behind icon on active step */}
        {isActive && !isCompleted && (
          <div className="absolute w-11 h-11 rounded-full bg-primary/20" />
        )}
        <div
          className={cn(
            "relative w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200",
            isCompleted && "bg-primary text-primary-foreground",
            isActive && !isCompleted && "bg-primary text-primary-foreground",
            !isActive && !isCompleted && "bg-muted text-muted-foreground border border-border",
          )}
        >
          {isCompleted ? (
            <Check className="h-4 w-4" />
          ) : (
            stepNumber
          )}
        </div>
        {/* Label positioned below icon, outside flex flow */}
        <span
          className={cn(
            "absolute top-full mt-1.5 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap transition-colors",
            isActive ? "text-primary font-medium" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        </span>
      </TabsPrimitive.Trigger>
    </>
  );
};

WorkflowStep.propTypes = {
  value: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  stepNumber: PropTypes.number.isRequired,
};

// ── Content panel (animated slide) ───────────────────────────────────
const WorkflowContent = React.forwardRef(
  ({ className, value, children, ...props }, ref) => {
    const { direction } = useWorkflow();

    return (
      <TabsPrimitive.Content
        ref={ref}
        value={value}
        className={cn("overflow-hidden focus-visible:outline-none", className)}
        {...props}
      >
        <motion.div
          initial={{ x: direction * SLIDE_DISTANCE, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={SPRING}
        >
          {children}
        </motion.div>
      </TabsPrimitive.Content>
    );
  },
);
WorkflowContent.displayName = "WorkflowContent";

WorkflowContent.propTypes = {
  className: PropTypes.string,
  value: PropTypes.string.isRequired,
  children: PropTypes.node,
};

// ── Navigation (Back / Next / Finish) ────────────────────────────────
const WorkflowNav = ({
  canProceed = true,
  nextLabel,
  finishLabel,
  onFinish,
  className,
}) => {
  const { isFirstStep, isLastStep, goBack, goNext } = useWorkflow();
  const { t } = useTranslation("common");

  return (
    <div className={cn("flex justify-between mt-6", className)}>
      {!isFirstStep ? (
        <Button variant="outline" onClick={goBack} type="button">
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t("back")}
        </Button>
      ) : (
        <div />
      )}

      {isLastStep ? (
        <Button
          onClick={onFinish}
          disabled={!canProceed}
          type="button"
        >
          {finishLabel || t("finish")}
        </Button>
      ) : (
        <Button
          onClick={goNext}
          disabled={!canProceed}
          type="button"
        >
          {nextLabel || t("next")}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );
};

WorkflowNav.propTypes = {
  canProceed: PropTypes.bool,
  nextLabel: PropTypes.string,
  finishLabel: PropTypes.string,
  onFinish: PropTypes.func,
  className: PropTypes.string,
};

export {
  Workflow,
  WorkflowSteps,
  WorkflowStep,
  WorkflowContent,
  WorkflowNav,
  useWorkflow,
};
