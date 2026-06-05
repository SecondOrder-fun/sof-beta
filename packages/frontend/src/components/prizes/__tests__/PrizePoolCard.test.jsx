import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/useSofDecimals", () => ({ useSofDecimals: () => 18 }));

import PrizePoolCard from "@/components/prizes/PrizePoolCard";

const ONE = 10n ** 18n;

describe("PrizePoolCard", () => {
  it("renders grand (65%) and consolation (35%) from reserves", () => {
    render(<PrizePoolCard curveReservesWei={1000n * ONE} totalParticipants={8} />);
    expect(screen.getByText(/650/)).toBeInTheDocument();
    expect(screen.getByText(/350/)).toBeInTheDocument();
  });

  it("renders the live participant count", () => {
    render(<PrizePoolCard curveReservesWei={1000n * ONE} totalParticipants={142} />);
    expect(screen.getByText("142")).toBeInTheDocument();
  });

  it("renders per-player share (consolation / (participants-1))", () => {
    render(<PrizePoolCard curveReservesWei={1000n * ONE} totalParticipants={8} />);
    expect(screen.getByText(/^50/)).toBeInTheDocument();
  });
});
