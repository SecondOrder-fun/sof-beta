import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const FIX = {
  "disclaimer.pageTitle": "Disclaimer",
  "disclaimer.intro": "Disclaimer intro",
  "disclaimer.sections": [
    { heading: "Alpha software", body: ["It is experimental.", "- risk one"] },
  ],
  "faq.pageTitle": "FAQ",
  "faq.intro": "FAQ intro",
  "faq.faqItems": [{ question: "What is it?", answer: "A test." }],
  "placeholderBanner.title": "Placeholder document — not legally binding",
  "placeholderBanner.body": "Non-binding placeholder.",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k in FIX) return FIX[k];
      if (o && o.returnObjects) return k; // missing object key → return key (non-array)
      return o?.defaultValue ?? k;
    },
  }),
}));

import ContentPage from "@/components/content/ContentPage";

describe("ContentPage", () => {
  it("renders a prose doc with title, intro, sections, and the placeholder banner when placeholder=true", () => {
    render(<ContentPage docKey="disclaimer" placeholder />);
    expect(
      screen.getByRole("heading", { name: "Disclaimer" })
    ).toBeInTheDocument();
    expect(screen.getByText("Disclaimer intro")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Alpha software" })
    ).toBeInTheDocument();
    expect(screen.getByText("It is experimental.")).toBeInTheDocument();
    expect(screen.getByText("risk one")).toBeInTheDocument();
    expect(
      screen.getByText("Placeholder document — not legally binding")
    ).toBeInTheDocument();
  });

  it("omits the placeholder banner when placeholder is not set", () => {
    render(<ContentPage docKey="faq" />);
    expect(
      screen.queryByText("Placeholder document — not legally binding")
    ).not.toBeInTheDocument();
  });

  it("renders FAQ items (not prose sections) for a doc with faqItems", () => {
    render(<ContentPage docKey="faq" />);
    expect(screen.getByText("What is it?")).toBeInTheDocument();
  });
});
