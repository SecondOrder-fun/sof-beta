/*
  @vitest-environment jsdom
*/
/* eslint-disable react/prop-types */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useSofDecimals", () => ({
  useSofDecimals: () => 18,
}));

// Mock Recharts components to render testable DOM elements
vi.mock("recharts", async () => {
  const { createElement: h } = await import("react");
  return {
    ResponsiveContainer: ({ children }) => h("div", { "data-testid": "responsive-container" }, children),
    AreaChart: ({ children, data }) =>
      h("svg", { "data-testid": "area-chart", "data-points": data?.length ?? 0 }, children),
    Area: ({ dataKey }) => h("g", { "data-testid": `area-${dataKey}` }),
    XAxis: () => h("g", { "data-testid": "x-axis" }),
    YAxis: ({ domain }) =>
      h("g", { "data-testid": "y-axis", "data-domain-min": domain?.[0], "data-domain-max": domain?.[1] }),
    CartesianGrid: () => h("g", { "data-testid": "cartesian-grid" }),
    Tooltip: () => h("g", { "data-testid": "tooltip" }),
    ReferenceLine: ({ x, stroke }) =>
      h("line", { "data-testid": "reference-line", "data-x": x, stroke }),
    ReferenceDot: ({ x, y, r, fill }) =>
      h("circle", { "data-testid": "reference-dot", cx: x, cy: y, r, fill }),
  };
});

import BondingCurvePanel from "@/components/curve/CurveGraph.jsx";

describe("BondingCurvePanel Y-axis domain", () => {
  it("renders chart with correct data points reflecting step prices", () => {
    const steps = [
      { step: 1n, rangeTo: 1000n, price: 1000000000000000000n }, // 1.0 SOF
      { step: 2n, rangeTo: 2000n, price: 2000000000000000000n }, // 2.0 SOF
    ];

    const { container } = render(
      <BondingCurvePanel
        curveSupply={0n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
      />,
    );

    // Chart renders with many data points for smooth tooltip tracking
    // 2 steps × ~150 intermediate points each + boundary points
    const chart = container.querySelector("[data-testid='area-chart']");
    expect(chart).toBeTruthy();
    expect(Number(chart.getAttribute("data-points"))).toBeGreaterThan(4);

    // Y-axis domain starts at 0
    const yAxis = container.querySelector("[data-testid='y-axis']");
    expect(yAxis).toBeTruthy();
    expect(yAxis.getAttribute("data-domain-min")).toBe("0");

    // Full mode shows stats grid with current price (1.0000 SOF)
    expect(screen.getByText("1.0000")).toBeTruthy();
  });

  it("shows empty state when no steps provided", () => {
    render(
      <BondingCurvePanel
        curveSupply={0n}
        curveStep={null}
        allBondSteps={[]}
      />,
    );

    expect(screen.getByText("noBondingCurveData")).toBeTruthy();
  });

  it("renders step boundary dots for each step", () => {
    const steps = [
      { step: 1n, rangeTo: 1000n, price: 500000000000000000n },  // 0.5 SOF
      { step: 2n, rangeTo: 2000n, price: 1000000000000000000n }, // 1.0 SOF
      { step: 3n, rangeTo: 3000n, price: 1500000000000000000n }, // 1.5 SOF
    ];

    const { container } = render(
      <BondingCurvePanel
        curveSupply={0n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
      />,
    );

    // ReferenceDot is used for step boundary dots — expect 3 (one per step)
    const dots = container.querySelectorAll("[data-testid='reference-dot']");
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it("hides axes in mini mode", () => {
    const steps = [
      { step: 1n, rangeTo: 1000n, price: 1000000000000000000n },
    ];

    const { container } = render(
      <BondingCurvePanel
        curveSupply={0n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
        mini
      />,
    );

    // Chart renders
    const chart = container.querySelector("[data-testid='area-chart']");
    expect(chart).toBeTruthy();

    // No stats grid or progress bar in mini mode
    expect(screen.queryByText("currentStep")).toBeFalsy();
    expect(screen.queryByText("bondingCurveProgress")).toBeFalsy();
  });
});
