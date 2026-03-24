/*
  @vitest-environment jsdom
*/
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import ProgressBar from "@/components/mobile/ProgressBar";

describe("ProgressBar", () => {
  it("renders sold and max labels", () => {
    render(<ProgressBar current={20500n} max={100000n} />);

    expect(screen.getByText("20500 sold")).toBeInTheDocument();
    expect(screen.getByText("100000 max")).toBeInTheDocument();
  });

  it("fills at least one segment when current > 0 and max > 0", () => {
    const { container } = render(<ProgressBar current={1n} max={100000n} />);

    const segments = container.querySelectorAll(".flex-1.h-2.rounded-full");
    expect(segments.length).toBe(10);

    const filled = Array.from(segments).filter((el) =>
      el.className.includes("bg-primary"),
    );
    expect(filled.length).toBeGreaterThan(0);
  });

  it("renders no filled segments when max is zero", () => {
    const { container } = render(<ProgressBar current={100n} max={0n} />);

    const segments = container.querySelectorAll(".flex-1.h-2.rounded-full");
    const filled = Array.from(segments).filter((el) =>
      el.className.includes("bg-primary"),
    );

    expect(filled.length).toBe(0);
  });
});
