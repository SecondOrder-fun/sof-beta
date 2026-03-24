// src/components/admin/BondingCurveEditor/useCurveEditor.js
// Shared state hook for bonding curve editor across all views

import { useState, useCallback, useMemo } from "react";
import { parseUnits } from "viem";

// Default values
const DEFAULT_MAX_TICKETS = 100000;
const DEFAULT_NUM_STEPS = 10;
const DEFAULT_BASE_PRICE = 10;
const DEFAULT_PRICE_DELTA = 1;

/**
 * Generate linear bond steps from simple parameters
 */
export function generateLinearSteps(maxTickets, numSteps, basePrice, priceDelta, decimals = 18) {
  if (!maxTickets || !numSteps || numSteps <= 0) return [];

  const stepSize = Math.ceil(maxTickets / numSteps);
  return Array.from({ length: numSteps }, (_, i) => {
    const rangeTo = Math.min(stepSize * (i + 1), maxTickets);
    const price = basePrice + i * priceDelta;
    const priceScaledBig = parseUnits(price.toString(), decimals);

    return {
      rangeTo,
      price,
      priceScaled: priceScaledBig.toString(),
    };
  });
}

/**
 * Check if steps match a linear pattern (can be represented by simple params)
 */
export function isLinearCurve(steps, maxTickets) {
  if (!steps || steps.length < 2) return true;

  // Check if all step sizes are equal (within tolerance)
  const expectedStepSize = Math.ceil(maxTickets / steps.length);
  const tolerance = 1; // Allow 1 ticket difference due to rounding

  for (let i = 0; i < steps.length; i++) {
    const expectedRangeTo = Math.min(expectedStepSize * (i + 1), maxTickets);
    if (Math.abs(steps[i].rangeTo - expectedRangeTo) > tolerance) {
      return false;
    }
  }

  // Check if price increases are constant
  if (steps.length < 2) return true;
  const delta = steps[1].price - steps[0].price;

  for (let i = 2; i < steps.length; i++) {
    const currentDelta = steps[i].price - steps[i - 1].price;
    if (Math.abs(currentDelta - delta) > 0.0001) {
      return false;
    }
  }

  return true;
}

/**
 * Apply proportional scaling when dragging a point
 * @param {Array} steps - Current steps array
 * @param {number} dragIndex - Index of the dragged point
 * @param {number} newPrice - New price for the dragged point
 * @param {number} minPrice - Minimum allowed price (0.01)
 * @returns {Array} - New steps array with proportionally scaled prices
 */
export function applyProportionalScaling(steps, dragIndex, newPrice, minPrice = 0.01) {
  if (!steps || steps.length === 0) return steps;

  const newSteps = steps.map((s) => ({ ...s }));
  const oldPrice = steps[dragIndex].price;
  const delta = newPrice - oldPrice;

  // Apply weighted scaling to all points
  for (let i = 0; i < newSteps.length; i++) {
    if (i === dragIndex) {
      newSteps[i].price = Math.max(minPrice, newPrice);
    } else {
      // Calculate distance-based weight (closer = more influence)
      const distance = Math.abs(i - dragIndex);
      const maxDistance = Math.max(dragIndex, steps.length - 1 - dragIndex);
      const weight = maxDistance > 0 ? 1 - (distance / (maxDistance + 1)) : 0;

      // Apply weighted delta
      const adjustment = delta * weight * 0.5; // 50% influence factor
      newSteps[i].price = Math.max(minPrice, steps[i].price + adjustment);
    }
  }

  // Ensure monotonic increase (each price >= previous)
  for (let i = 1; i < newSteps.length; i++) {
    if (newSteps[i].price < newSteps[i - 1].price) {
      newSteps[i].price = newSteps[i - 1].price + 0.01;
    }
  }

  return newSteps;
}

/**
 * Update priceScaled values from human-readable prices
 */
export function updatePriceScaled(steps, decimals = 18) {
  return steps.map((step) => ({
    ...step,
    priceScaled: parseUnits(step.price.toFixed(6), decimals).toString(),
  }));
}

/**
 * Validate steps array
 */
export function validateSteps(steps, maxTickets) {
  const errors = [];

  if (!steps || steps.length === 0) {
    errors.push("At least one step is required");
    return errors;
  }

  // Check rangeTo is monotonically increasing
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].rangeTo <= steps[i - 1].rangeTo) {
      errors.push(`Step ${i + 1} rangeTo must be greater than step ${i}`);
    }
  }

  // Check final rangeTo matches maxTickets
  const lastRangeTo = steps[steps.length - 1].rangeTo;
  if (lastRangeTo !== maxTickets) {
    errors.push(`Final step rangeTo (${lastRangeTo}) must equal max tickets (${maxTickets})`);
  }

  // Check all prices are positive
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].price <= 0) {
      errors.push(`Step ${i + 1} price must be positive`);
    }
  }

  return errors;
}

/**
 * Main hook for curve editor state management
 */
export function useCurveEditor(initialSteps = null, sofDecimals = 18) {
  // Simple view parameters
  const [maxTickets, setMaxTickets] = useState(DEFAULT_MAX_TICKETS);
  const [numSteps, setNumSteps] = useState(DEFAULT_NUM_STEPS);
  const [basePrice, setBasePrice] = useState(DEFAULT_BASE_PRICE);
  const [priceDelta, setPriceDelta] = useState(DEFAULT_PRICE_DELTA);

  // The actual steps array (source of truth)
  const [steps, setSteps] = useState(() => {
    if (initialSteps && initialSteps.length > 0) {
      return initialSteps;
    }
    return generateLinearSteps(
      DEFAULT_MAX_TICKETS,
      DEFAULT_NUM_STEPS,
      DEFAULT_BASE_PRICE,
      DEFAULT_PRICE_DELTA,
      sofDecimals
    );
  });

  // Track if curve has been customized
  const [isCustom, setIsCustom] = useState(false);

  // Regenerate linear steps from simple params
  const regenerateFromSimple = useCallback(() => {
    const newSteps = generateLinearSteps(maxTickets, numSteps, basePrice, priceDelta, sofDecimals);
    setSteps(newSteps);
    setIsCustom(false);
  }, [maxTickets, numSteps, basePrice, priceDelta, sofDecimals]);

  // Update a single step (from Advanced view)
  const updateStep = useCallback((index, field, value) => {
    setSteps((prev) => {
      const newSteps = [...prev];
      newSteps[index] = { ...newSteps[index], [field]: value };

      // Update priceScaled if price changed
      if (field === "price") {
        newSteps[index].priceScaled = parseUnits(value.toFixed(6), sofDecimals).toString();
      }

      return newSteps;
    });
    setIsCustom(true);
  }, [sofDecimals]);

  // Add a new step
  const addStep = useCallback(() => {
    setSteps((prev) => {
      if (prev.length === 0) {
        return [{
          rangeTo: maxTickets,
          price: basePrice,
          priceScaled: parseUnits(basePrice.toString(), sofDecimals).toString(),
        }];
      }

      const lastStep = prev[prev.length - 1];
      const newRangeTo = lastStep.rangeTo;

      // Insert before last, adjust last step's rangeTo
      const insertPoint = Math.floor(lastStep.rangeTo * 0.9);
      const newSteps = [...prev];
      newSteps[newSteps.length - 1] = {
        ...lastStep,
        rangeTo: newRangeTo,
      };

      // Insert new step
      newSteps.splice(prev.length - 1, 0, {
        rangeTo: insertPoint,
        price: (lastStep.price + prev[prev.length - 2]?.price) / 2 || lastStep.price - 1,
        priceScaled: parseUnits(((lastStep.price + (prev[prev.length - 2]?.price || lastStep.price - 1)) / 2).toFixed(6), sofDecimals).toString(),
      });

      return newSteps;
    });
    setIsCustom(true);
  }, [maxTickets, basePrice, sofDecimals]);

  // Remove a step
  const removeStep = useCallback((index) => {
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      const newSteps = prev.filter((_, i) => i !== index);

      // Ensure last step reaches maxTickets
      if (newSteps.length > 0) {
        newSteps[newSteps.length - 1].rangeTo = maxTickets;
      }

      return newSteps;
    });
    setIsCustom(true);
  }, [maxTickets]);

  // Apply proportional scaling from graph drag (Y-axis only)
  const applyDrag = useCallback((dragIndex, newPrice) => {
    setSteps((prev) => {
      const scaled = applyProportionalScaling(prev, dragIndex, newPrice);
      return updatePriceScaled(scaled, sofDecimals);
    });
    setIsCustom(true);
  }, [sofDecimals]);

  // Update step position (X and Y axis) for graph dragging
  const updateStepPosition = useCallback((index, newRangeTo, newPrice) => {
    // Guard against invalid inputs
    if (index === undefined || index === null ||
        newRangeTo === undefined || newPrice === undefined ||
        Number.isNaN(newRangeTo) || Number.isNaN(newPrice)) {
      return;
    }

    setSteps((prev) => {
      if (index < 0 || index >= prev.length) return prev;

      const newSteps = [...prev];
      const isLast = index === prev.length - 1;

      // Clamp rangeTo within valid bounds
      const minRangeTo = index === 0 ? 1 : prev[index - 1].rangeTo + 1;
      const maxRangeToVal = isLast ? maxTickets : prev[index + 1]?.rangeTo - 1 || maxTickets;
      const clampedRangeTo = isLast
        ? maxTickets // Last step must always equal maxTickets
        : Math.max(minRangeTo, Math.min(maxRangeToVal, Math.round(newRangeTo)));

      // Clamp price
      const clampedPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);

      newSteps[index] = {
        ...newSteps[index],
        rangeTo: clampedRangeTo,
        price: clampedPrice,
        priceScaled: parseUnits(clampedPrice.toFixed(6), sofDecimals).toString(),
      };

      return newSteps;
    });
    setIsCustom(true);
  }, [maxTickets, sofDecimals]);

  // Insert a step between two existing steps
  const insertStepBetween = useCallback((afterIndex) => {
    setSteps((prev) => {
      if (afterIndex < 0 || afterIndex >= prev.length - 1) return prev;

      const stepBefore = prev[afterIndex];
      const stepAfter = prev[afterIndex + 1];

      // Calculate midpoint for rangeTo and price
      const midRangeTo = Math.floor((stepBefore.rangeTo + stepAfter.rangeTo) / 2);
      const midPrice = (stepBefore.price + stepAfter.price) / 2;

      const newStep = {
        rangeTo: midRangeTo,
        price: midPrice,
        priceScaled: parseUnits(midPrice.toFixed(6), sofDecimals).toString(),
      };

      // Insert after the specified index
      const newSteps = [...prev];
      newSteps.splice(afterIndex + 1, 0, newStep);

      return newSteps;
    });
    setIsCustom(true);
  }, [sofDecimals]);

  // Reset to linear
  const resetToLinear = useCallback(() => {
    regenerateFromSimple();
  }, [regenerateFromSimple]);

  // Validation errors
  const validationErrors = useMemo(() => {
    return validateSteps(steps, maxTickets);
  }, [steps, maxTickets]);

  const isValid = validationErrors.length === 0;

  // Check if current steps are linear
  const canUseSimpleMode = useMemo(() => {
    return isLinearCurve(steps, maxTickets);
  }, [steps, maxTickets]);

  return {
    // State
    steps,
    maxTickets,
    numSteps,
    basePrice,
    priceDelta,
    isCustom,
    isValid,
    validationErrors,
    canUseSimpleMode,

    // Simple param setters (auto-regenerate)
    setMaxTickets: (value) => {
      setMaxTickets(value);
      if (!isCustom) {
        const newSteps = generateLinearSteps(value, numSteps, basePrice, priceDelta, sofDecimals);
        setSteps(newSteps);
      } else {
        // Adjust last step to match new maxTickets
        setSteps((prev) => {
          const newSteps = [...prev];
          if (newSteps.length > 0) {
            newSteps[newSteps.length - 1].rangeTo = value;
          }
          return newSteps;
        });
      }
    },
    setNumSteps: (value) => {
      setNumSteps(value);
      if (!isCustom) {
        const newSteps = generateLinearSteps(maxTickets, value, basePrice, priceDelta, sofDecimals);
        setSteps(newSteps);
      }
    },
    setBasePrice: (value) => {
      setBasePrice(value);
      if (!isCustom) {
        const newSteps = generateLinearSteps(maxTickets, numSteps, value, priceDelta, sofDecimals);
        setSteps(newSteps);
      }
    },
    setPriceDelta: (value) => {
      setPriceDelta(value);
      if (!isCustom) {
        const newSteps = generateLinearSteps(maxTickets, numSteps, basePrice, value, sofDecimals);
        setSteps(newSteps);
      }
    },

    // Actions
    updateStep,
    addStep,
    removeStep,
    applyDrag,
    updateStepPosition,
    insertStepBetween,
    resetToLinear,
    setSteps,
    setIsCustom,
  };
}

export default useCurveEditor;
