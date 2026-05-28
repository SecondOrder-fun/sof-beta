/*
  @vitest-environment jsdom
*/
/* eslint-disable react/prop-types */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useSofDecimals", () => ({
  useSofDecimals: () => 18,
}));

// Mock Recharts so the panel renders testable DOM and the full-mode stats grid.
vi.mock("recharts", async () => {
  const { createElement: h } = await import("react");
  return {
    ResponsiveContainer: ({ children }) => h("div", null, children),
    AreaChart: ({ children }) => h("svg", { "data-testid": "area-chart" }, children),
    Area: () => h("g"),
    XAxis: () => h("g"),
    YAxis: () => h("g"),
    CartesianGrid: () => h("g"),
    Tooltip: () => h("g"),
    ReferenceLine: () => h("line"),
    ReferenceDot: () => h("circle"),
  };
});

import BondingCurvePanel from "@/components/curve/CurveGraph.jsx";

describe("BondingCurvePanel current-price fallback (#145)", () => {
  const steps = [
    { step: 1n, rangeTo: 100n, price: 2000000000000000000n }, // 2.0000 SOF
    { step: 2n, rangeTo: 200n, price: 3000000000000000000n },
  ];

  it("shows step-0 price as Current Price when curveStep is null (pre-trade)", () => {
    render(
      <BondingCurvePanel curveSupply={0n} curveStep={null} allBondSteps={steps} />,
    );
    // Before the first trade the backend cache has no currentStep; the live
    // price is the starting tier, not 0.
    expect(screen.getByText("2.0000")).toBeTruthy();
    expect(screen.queryByText("0.0000")).toBeFalsy();
  });

  it("still uses the live curveStep price when present", () => {
    render(
      <BondingCurvePanel
        curveSupply={150n}
        curveStep={{ step: 2n, price: steps[1].price }}
        allBondSteps={steps}
      />,
    );
    // 3.0000 from the live step wins over step-0's 2.0000.
    expect(screen.getByText("3.0000")).toBeTruthy();
  });
});
