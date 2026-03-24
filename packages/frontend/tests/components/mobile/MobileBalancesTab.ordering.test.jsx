/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/components/account/InfoFiPositionsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="infofi-positions" />,
}));

// Mock Link from react-router-dom used inside the accordion content
vi.mock("react-router-dom", () => ({
  // eslint-disable-next-line react/prop-types
  Link: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

import MobileBalancesTab from "@/components/mobile/MobileBalancesTab";

describe("MobileBalancesTab", () => {
  it("renders raffle positions in reverse season order (most recent first)", () => {
    render(
      <MobileBalancesTab
        address="0x0000000000000000000000000000000000000001"
        sofBalance="0.0000"
        rafflePositions={[
          {
            seasonId: 11,
            name: "Season 11",
            token: "0x0000000000000000000000000000000000000011",
            ticketCount: "51",
          },
          {
            seasonId: 13,
            name: "Season 13",
            token: "0x0000000000000000000000000000000000000013",
            ticketCount: "10000",
          },
        ]}
      />,
    );

    // The component renders season names with "#id - name" format inside AccordionTrigger
    const season13 = screen.getByText(/^#13 - Season 13$/);
    const season11 = screen.getByText(/^#11 - Season 11$/);

    // Verify both render
    expect(season13).toBeInTheDocument();
    expect(season11).toBeInTheDocument();

    // Season 13 should appear before Season 11 in the DOM (reverse order)
    const allButtons = screen.getAllByRole("button");
    const triggerButtons = allButtons.filter(
      (btn) =>
        btn.textContent.includes("#13") || btn.textContent.includes("#11"),
    );
    expect(triggerButtons[0].textContent).toContain("#13");
    expect(triggerButtons[1].textContent).toContain("#11");
  });
});
