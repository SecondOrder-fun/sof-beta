/**
 * Quantity Stepper
 * Numeric input with increment/decrement buttons
 */

import PropTypes from "prop-types";
import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";

export const QuantityStepper = ({
  value,
  onChange,
  min = 1,
  max = Infinity,
  step = 1,
  maxValidationMessage,
  minValidationMessage,
  trailing,
  className = "",
}) => {
  const [inputValue, setInputValue] = useState(() => `${value}`);

  useEffect(() => {
    setInputValue(`${value}`);
  }, [value]);

  const parsedCurrent = useMemo(() => {
    const asNumber = Number(inputValue);
    if (!Number.isFinite(asNumber)) return min;
    return Math.floor(asNumber);
  }, [inputValue, min]);

  const handleIncrement = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const base = Math.max(min, Math.min(max, parsedCurrent));
    const newValue = Math.min(base + step, max);
    onChange(`${newValue}`);
  };

  const handleDecrement = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const base = Math.max(min, Math.min(max, parsedCurrent));
    const newValue = Math.max(base - step, min);
    onChange(`${newValue}`);
  };

  const handleInputChange = (e) => {
    const next = e.target.value;

    if (typeof e.target?.setCustomValidity === "function") {
      e.target.setCustomValidity("");
    }

    // Allow clearing the input; parent will disable submit when invalid.
    if (next === "") {
      setInputValue("");
      onChange("");
      return;
    }

    // Allow only digits (type=number still allows e/E/- in some browsers)
    if (!/^\d+$/.test(next)) {
      return;
    }

    setInputValue(next);
    onChange(next);
  };

  const handleInvalid = (e) => {
    if (typeof e.target?.setCustomValidity !== "function") return;

    const current = Number(e.target.value);
    if (!Number.isFinite(current)) return;

    if (Number.isFinite(max) && current > max && maxValidationMessage) {
      e.target.setCustomValidity(maxValidationMessage);
      return;
    }

    if (Number.isFinite(min) && current < min && minValidationMessage) {
      e.target.setCustomValidity(minValidationMessage);
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Input
        type="number"
        value={inputValue}
        onChange={handleInputChange}
        onInvalid={handleInvalid}
        min={min}
        max={max}
        className="flex-1 h-12 text-center text-lg font-semibold"
      />

      <ButtonGroup>
        <Button
          size="icon"
          variant="outline"
          onClick={handleDecrement}
          disabled={parsedCurrent <= min}
          className="h-12 w-12 shrink-0"
          type="button"
        >
          <Minus className="w-5 h-5" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={handleIncrement}
          disabled={parsedCurrent >= max}
          className="h-12 w-12 shrink-0"
          type="button"
        >
          <Plus className="w-5 h-5" />
        </Button>
        {trailing}
      </ButtonGroup>
    </div>
  );
};

QuantityStepper.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
  maxValidationMessage: PropTypes.string,
  minValidationMessage: PropTypes.string,
  trailing: PropTypes.node,
  className: PropTypes.string,
};

export default QuantityStepper;
