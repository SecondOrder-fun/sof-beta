// src/components/admin/BondingCurveEditor/AdvancedView.jsx
// Advanced table/card view for editing individual bond steps

import { useState, useCallback } from "react";
import PropTypes from "prop-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, AlertCircle, PlusCircle } from "lucide-react";

const StepCard = ({
  step,
  index,
  prevRangeTo,
  isLast,
  maxTickets,
  onUpdate,
  onRemove,
  canRemove,
  validationError,
}) => {
  const ticketsInStep = step.rangeTo - prevRangeTo;

  // Allow empty fields while editing; commit on blur
  const [draftRangeTo, setDraftRangeTo] = useState(null);
  const [draftPrice, setDraftPrice] = useState(null);

  const handleRangeToChange = useCallback((e) => {
    const raw = e.target.value;
    setDraftRangeTo(raw);
    const n = Number(raw);
    if (raw !== "" && !Number.isNaN(n) && n > 0) onUpdate("rangeTo", n);
  }, [onUpdate]);

  const handleRangeToBlur = useCallback(() => {
    if (draftRangeTo === null) return;
    const n = Number(draftRangeTo);
    if (draftRangeTo === "" || Number.isNaN(n) || n <= 0) {
      onUpdate("rangeTo", step.rangeTo); // reset to current
    }
    setDraftRangeTo(null);
  }, [draftRangeTo, onUpdate, step.rangeTo]);

  const handlePriceChange = useCallback((e) => {
    const raw = e.target.value;
    setDraftPrice(raw);
    const n = Number(raw);
    if (raw !== "" && !Number.isNaN(n) && n > 0) onUpdate("price", n);
  }, [onUpdate]);

  const handlePriceBlur = useCallback(() => {
    if (draftPrice === null) return;
    const n = Number(draftPrice);
    if (draftPrice === "" || Number.isNaN(n) || n <= 0) {
      onUpdate("price", step.price); // reset to current
    }
    setDraftPrice(null);
  }, [draftPrice, onUpdate, step.price]);

  return (
    <div className={`p-3 rounded-lg border ${validationError ? "border-destructive/50 bg-destructive/10" : "bg-card"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            Step {index + 1}
          </Badge>
          {isLast && (
            <Badge variant="secondary" className="text-xs">
              Final
            </Badge>
          )}
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            Range: {prevRangeTo.toLocaleString()} →
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={prevRangeTo + 1}
              max={isLast ? maxTickets : undefined}
              value={draftRangeTo !== null ? draftRangeTo : step.rangeTo}
              onChange={handleRangeToChange}
              onBlur={handleRangeToBlur}
              className="font-mono"
              disabled={isLast} // Last step must equal maxTickets
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({ticketsInStep.toLocaleString()} tickets)
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Price (SOF)</label>
          <Input
            type="number"
            min={0.01}
            step={0.01}
            value={draftPrice !== null ? draftPrice : step.price}
            onChange={handlePriceChange}
            onBlur={handlePriceBlur}
            className="font-mono"
          />
        </div>
      </div>

      {validationError && (
        <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {validationError}
        </div>
      )}
    </div>
  );
};

StepCard.propTypes = {
  step: PropTypes.shape({
    rangeTo: PropTypes.number.isRequired,
    price: PropTypes.number.isRequired,
    priceScaled: PropTypes.string,
  }).isRequired,
  index: PropTypes.number.isRequired,
  prevRangeTo: PropTypes.number.isRequired,
  isLast: PropTypes.bool.isRequired,
  maxTickets: PropTypes.number.isRequired,
  onUpdate: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  canRemove: PropTypes.bool.isRequired,
  validationError: PropTypes.string,
};

// Insert between button component
const InsertBetweenButton = ({ onClick, afterIndex }) => (
  <div className="flex items-center justify-center py-1">
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-6 px-2 text-xs text-muted-foreground hover:text-info hover:bg-info/10 gap-1"
      title={`Insert step between ${afterIndex + 1} and ${afterIndex + 2}`}
    >
      <PlusCircle className="h-3 w-3" />
      <span>Insert between</span>
    </Button>
  </div>
);

InsertBetweenButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  afterIndex: PropTypes.number.isRequired,
};

const AdvancedView = ({
  steps,
  maxTickets,
  setMaxTickets,
  updateStep,
  addStep,
  removeStep,
  insertStepBetween,
  validationErrors,
}) => {
  // Draft state for max tickets input (same pattern as StepCard)
  const [draftMaxTickets, setDraftMaxTickets] = useState(null);

  const handleMaxTicketsChange = useCallback((e) => {
    const raw = e.target.value;
    setDraftMaxTickets(raw);
    const n = Number(raw);
    if (raw !== "" && !Number.isNaN(n) && n >= 1) setMaxTickets(n);
  }, [setMaxTickets]);

  const handleMaxTicketsBlur = useCallback(() => {
    if (draftMaxTickets === null) return;
    const n = Number(draftMaxTickets);
    if (draftMaxTickets === "" || Number.isNaN(n) || n < 1) {
      setMaxTickets(maxTickets); // reset to current
    }
    setDraftMaxTickets(null);
  }, [draftMaxTickets, setMaxTickets, maxTickets]);
  // Build per-step validation error map
  const stepErrors = {};
  validationErrors.forEach((error) => {
    const match = error.match(/Step (\d+)/);
    if (match) {
      const stepNum = parseInt(match[1], 10);
      stepErrors[stepNum - 1] = error;
    }
  });

  return (
    <div className="space-y-3">
      {/* Max Tickets */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Max Tickets</label>
        <Input
          type="number"
          min={1}
          value={draftMaxTickets !== null ? draftMaxTickets : maxTickets}
          onChange={handleMaxTicketsChange}
          onBlur={handleMaxTicketsBlur}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Total ticket supply (adjusts last step range)
        </p>
      </div>

      {/* Global errors */}
      {validationErrors.filter((e) => !e.match(/Step \d+/)).length > 0 && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/50">
          {validationErrors
            .filter((e) => !e.match(/Step \d+/))
            .map((error, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            ))}
        </div>
      )}

      {/* Step cards with insert buttons between */}
      <div className="space-y-0 max-h-[400px] overflow-y-auto pr-1">
        {steps.map((step, index) => (
          <div key={index}>
            <StepCard
              step={step}
              index={index}
              prevRangeTo={index === 0 ? 0 : steps[index - 1].rangeTo}
              isLast={index === steps.length - 1}
              maxTickets={maxTickets}
              onUpdate={(field, value) => updateStep(index, field, value)}
              onRemove={() => removeStep(index)}
              canRemove={steps.length > 1}
              validationError={stepErrors[index]}
            />
            {/* Insert between button (not after last step) */}
            {index < steps.length - 1 && (
              <InsertBetweenButton
                onClick={() => insertStepBetween(index)}
                afterIndex={index}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add step button */}
      <Button
        type="button"
        variant="outline"
        onClick={addStep}
        className="w-full flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Add Step at End
      </Button>

      {/* Summary */}
      <div className="p-3 rounded-lg bg-muted/50 border text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Steps:</span>
          <span className="font-mono">{steps.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Price Range:</span>
          <span className="font-mono">
            {steps.length > 0 ? `${steps[0].price.toFixed(2)} → ${steps[steps.length - 1].price.toFixed(2)} SOF` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Tickets:</span>
          <span className="font-mono">
            {steps.length > 0 ? steps[steps.length - 1].rangeTo.toLocaleString() : 0}
          </span>
        </div>
      </div>
    </div>
  );
};

AdvancedView.propTypes = {
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      rangeTo: PropTypes.number.isRequired,
      price: PropTypes.number.isRequired,
      priceScaled: PropTypes.string,
    })
  ).isRequired,
  maxTickets: PropTypes.number.isRequired,
  setMaxTickets: PropTypes.func.isRequired,
  updateStep: PropTypes.func.isRequired,
  addStep: PropTypes.func.isRequired,
  removeStep: PropTypes.func.isRequired,
  insertStepBetween: PropTypes.func.isRequired,
  validationErrors: PropTypes.arrayOf(PropTypes.string).isRequired,
};

export default AdvancedView;
