/*
  @vitest-environment jsdom
*/
/* eslint-disable react/prop-types */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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
    Area: ({ dataKey, type }) =>
      h("g", { "data-testid": `area-${dataKey}`, "data-type": type }),
    XAxis: ({ hide }) =>
      h("g", { "data-testid": "x-axis", "data-hide": hide ? "true" : "false" }),
    YAxis: ({ hide }) =>
      h("g", { "data-testid": "y-axis", "data-hide": hide ? "true" : "false" }),
    CartesianGrid: () => h("g", { "data-testid": "cartesian-grid" }),
    Tooltip: () => h("g", { "data-testid": "tooltip" }),
    ReferenceLine: ({ x, stroke }) =>
      h("line", { "data-testid": "reference-line", "data-x": x, stroke }),
    ReferenceDot: ({ x, y, r, fill }) =>
      h("circle", { "data-testid": "reference-dot", cx: x, cy: y, r, fill }),
  };
});

import BondingCurvePanel from "@/components/curve/CurveGraph.jsx";

describe("BondingCurvePanel Recharts tooltip", () => {
  const steps = [
    { step: 1n, rangeTo: 1000n, price: 1000000000000000000n },
    { step: 2n, rangeTo: 2000n, price: 2000000000000000000n },
  ];

  it("renders Recharts AreaChart with Tooltip in full mode", () => {
    const { container } = render(
      <BondingCurvePanel
        curveSupply={0n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
      />,
    );

    const chart = container.querySelector("[data-testid='area-chart']");
    expect(chart).toBeTruthy();

    // Tooltip is rendered in full mode
    const tooltip = container.querySelector("[data-testid='tooltip']");
    expect(tooltip).toBeTruthy();

    // Area uses stepAfter type
    const area = container.querySelector("[data-testid='area-price']");
    expect(area).toBeTruthy();
    expect(area.getAttribute("data-type")).toBe("stepAfter");
  });

  it("does not render Tooltip in compact mode", () => {
    const { container } = render(
      <BondingCurvePanel
        curveSupply={500n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
        compact
      />,
    );

    const chart = container.querySelector("[data-testid='area-chart']");
    expect(chart).toBeTruthy();

    // No tooltip in compact mode
    const tooltip = container.querySelector("[data-testid='tooltip']");
    expect(tooltip).toBeFalsy();
  });

  it("does not render Tooltip in mini mode", () => {
    const { container } = render(
      <BondingCurvePanel
        curveSupply={500n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
        mini
      />,
    );

    const chart = container.querySelector("[data-testid='area-chart']");
    expect(chart).toBeTruthy();

    // No tooltip in mini mode
    const tooltip = container.querySelector("[data-testid='tooltip']");
    expect(tooltip).toBeFalsy();
  });

  it("renders current supply marker when supply > 0", () => {
    const { container } = render(
      <BondingCurvePanel
        curveSupply={500n}
        curveStep={{ step: 1n, price: steps[0].price }}
        allBondSteps={steps}
      />,
    );

    // ReferenceLine with orange stroke for current supply
    const refLines = container.querySelectorAll("[data-testid='reference-line']");
    const orangeLine = Array.from(refLines).find(
      (l) => l.getAttribute("stroke") === "#f97316",
    );
    expect(orangeLine).toBeTruthy();

    // ReferenceDot with orange fill for current supply
    const refDots = container.querySelectorAll("[data-testid='reference-dot']");
    const orangeDot = Array.from(refDots).find(
      (d) => d.getAttribute("fill") === "#f97316",
    );
    expect(orangeDot).toBeTruthy();
  });
});
