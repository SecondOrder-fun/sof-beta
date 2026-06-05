import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContentSections from "@/components/content/ContentSections";

describe("ContentSections", () => {
  it("renders nothing for empty or non-array input", () => {
    const { container: a } = render(<ContentSections sections={[]} />);
    expect(a.firstChild).toBeNull();
    const { container: b } = render(<ContentSections sections={undefined} />);
    expect(b.firstChild).toBeNull();
  });

  it("renders headings and paragraphs", () => {
    render(
      <ContentSections
        sections={[{ heading: "Risk", body: ["First para", "Second para"] }]}
      />
    );
    expect(screen.getByRole("heading", { name: "Risk" })).toBeInTheDocument();
    expect(screen.getByText("First para")).toBeInTheDocument();
    expect(screen.getByText("Second para")).toBeInTheDocument();
  });

  it("groups consecutive '- ' lines into one bullet list", () => {
    render(
      <ContentSections
        sections={[
          { heading: "List", body: ["Intro", "- alpha", "- beta", "Outro"] },
        ]}
      />
    );
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(1);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["alpha", "beta"]);
    // Non-bullet lines render as paragraphs, not list items
    expect(screen.getByText("Intro").tagName).toBe("P");
    expect(screen.getByText("Outro").tagName).toBe("P");
  });
});
