// src/components/admin/BondingCurveEditor/SimpleView.jsx
// Simple parameter-based view for linear bonding curves

import { useState, useCallback } from "react";
import PropTypes from "prop-types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Hook for numeric input that allows empty field while editing.
 * Commits the numeric value on blur; shows raw string while typing.
 */
function useNumericInput(value, setter, { min = 0, fallback = 0 } = {}) {
  const [draft, setDraft] = useState(null); // null = use value prop

  const displayValue = draft !== null ? draft : value;

  const onChange = useCallback((e) => {
    const raw = e.target.value;
    setDraft(raw); // let user type freely (including empty)
    // If it parses to a valid number, propagate immediately so the graph updates
    const n = Number(raw);
    if (raw !== "" && !Number.isNaN(n) && n >= min) {
      setter(n);
    }
  }, [setter, min]);

  const onBlur = useCallback(() => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft === "" || Number.isNaN(n) || n < min) {
      setter(fallback); // reset to fallback on bad input
    } else {
      setter(n);
    }
    setDraft(null); // switch back to controlled value
  }, [draft, setter, min, fallback]);

  return { displayValue, onChange, onBlur };
}

const SimpleView = ({
  maxTickets,
  numSteps,
  basePrice,
  priceDelta,
  isCustom,
  setMaxTickets,
  setNumSteps,
  setBasePrice,
  setPriceDelta,
  resetToLinear,
}) => {
  // Computed values for display
  const stepSize = numSteps > 0 ? Math.ceil(maxTickets / numSteps) : 0;
  const finalPrice = basePrice + (numSteps - 1) * priceDelta;

  // Numeric inputs that allow empty fields while editing
  const maxTicketsInput = useNumericInput(maxTickets, setMaxTickets, { min: 1, fallback: 100000 });
  const numStepsInput = useNumericInput(numSteps, setNumSteps, { min: 1, fallback: 10 });
  const basePriceInput = useNumericInput(basePrice, setBasePrice, { min: 0.01, fallback: 10 });
  const priceDeltaInput = useNumericInput(priceDelta, setPriceDelta, { min: 0, fallback: 1 });

  return (
    <div className="space-y-4">
      {isCustom && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted border border-border">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              Custom Curve
            </Badge>
            <span className="text-sm text-muted-foreground">
              Curve has been manually edited
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetToLinear}
            className="flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Reset to Linear
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Max Tickets</label>
          <Input
            type="number"
            min={1}
            value={maxTicketsInput.displayValue}
            onChange={maxTicketsInput.onChange}
            onBlur={maxTicketsInput.onBlur}
            disabled={isCustom}
          />
          <p className="text-xs text-muted-foreground">
            Total ticket supply
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Number of Steps</label>
          <Input
            type="number"
            min={1}
            max={100}
            value={numStepsInput.displayValue}
            onChange={numStepsInput.onChange}
            onBlur={numStepsInput.onBlur}
            disabled={isCustom}
          />
          <p className="text-xs text-muted-foreground">
            {stepSize.toLocaleString()} tickets per step
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Initial Price (SOF)</label>
          <Input
            type="number"
            min={0.01}
            step={0.01}
            value={basePriceInput.displayValue}
            onChange={basePriceInput.onChange}
            onBlur={basePriceInput.onBlur}
            disabled={isCustom}
          />
          <p className="text-xs text-muted-foreground">
            Starting price per ticket
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Step Price Increase (SOF)</label>
          <Input
            type="number"
            min={0}
            step={0.1}
            value={priceDeltaInput.displayValue}
            onChange={priceDeltaInput.onChange}
            onBlur={priceDeltaInput.onBlur}
            disabled={isCustom}
          />
          <p className="text-xs text-muted-foreground">
            Price increase per step
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="p-3 rounded-lg bg-muted/50 border">
        <h4 className="text-sm font-medium mb-2">Curve Summary</h4>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Price Range:</span>
            <p className="font-mono">
              {basePrice.toFixed(2)} → {finalPrice.toFixed(2)} SOF
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Tickets per Step:</span>
            <p className="font-mono">{stepSize.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Total Steps:</span>
            <p className="font-mono">{numSteps}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

SimpleView.propTypes = {
  maxTickets: PropTypes.number.isRequired,
  numSteps: PropTypes.number.isRequired,
  basePrice: PropTypes.number.isRequired,
  priceDelta: PropTypes.number.isRequired,
  isCustom: PropTypes.bool.isRequired,
  setMaxTickets: PropTypes.func.isRequired,
  setNumSteps: PropTypes.func.isRequired,
  setBasePrice: PropTypes.func.isRequired,
  setPriceDelta: PropTypes.func.isRequired,
  resetToLinear: PropTypes.func.isRequired,
};

export default SimpleView;
