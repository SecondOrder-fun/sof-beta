// src/lib/curvePresets.js
// Bonding curve presets for the mobile create-season flow.

export const CURVE_PRESETS = [
  {
    id: "standard",
    labelKey: "curveStandard",
    descKey: "curveStandardDesc",
    maxTickets: 100000,
    numSteps: 10,
    basePrice: 10,
    priceDelta: 1,
  },
  {
    id: "aggressive",
    labelKey: "curveAggressive",
    descKey: "curveAggressiveDesc",
    maxTickets: 100000,
    numSteps: 10,
    basePrice: 5,
    priceDelta: 3,
  },
  {
    id: "flat",
    labelKey: "curveFlat",
    descKey: "curveFlatDesc",
    maxTickets: 100000,
    numSteps: 5,
    basePrice: 10,
    priceDelta: 0,
  },
];
