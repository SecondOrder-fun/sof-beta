/*
  @vitest-environment jsdom
*/
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button template variants", () => {
  it("maps variant=primary to the default styling", () => {
    render(<Button variant="primary">Primary</Button>);

    const btn = screen.getByRole("button", { name: "Primary" });
    expect(btn.className).toContain("bg-primary");
  });

  it("maps variant=danger to destructive", () => {
    render(<Button variant="danger">Danger</Button>);

    const btn = screen.getByRole("button", { name: "Danger" });
    expect(btn.className).toContain("bg-destructive");
  });

  it("still supports existing shadcn-style variants", () => {
    render(<Button variant="outline">Outline</Button>);

    const btn = screen.getByRole("button", { name: "Outline" });
    expect(btn.className).toContain("border");
  });
});
