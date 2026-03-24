/*
  @vitest-environment jsdom
*/

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, params) => params?.defaultValue || key,
  }),
}));

import MobileBalancesTab from "@/components/mobile/MobileBalancesTab";

describe("MobileBalancesTab loading vs empty state", () => {
  it("shows Loading... when raffle balances are still loading", () => {
    render(
      <MobileBalancesTab
        address="0x1111111111111111111111111111111111111111"
        sofBalance="0.0000"
        rafflePositions={[]}
        isLoadingRafflePositions
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows No balances only after loading completes and there are no results", () => {
    render(
      <MobileBalancesTab
        address="0x1111111111111111111111111111111111111111"
        sofBalance="0.0000"
        rafflePositions={[]}
        isLoadingRafflePositions={false}
      />,
    );

    expect(screen.getByText("account:noTicketBalances")).toBeInTheDocument();
  });
});
