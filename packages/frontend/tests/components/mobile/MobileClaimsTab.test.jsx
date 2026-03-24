/*
  @vitest-environment jsdom
*/

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, params) => {
      if (key === "account:claims") return "Claims";
      if (key === "market:claimDescription") {
        return (
          params?.defaultValue || "Claimable raffle prizes and market winnings."
        );
      }
      return key;
    },
  }),
}));

// Mock MobileFaucetWidget to avoid WagmiProvider dependency
vi.mock("@/components/mobile/MobileFaucetWidget", () => ({
  default: () => <div data-testid="mock-faucet-widget" />,
}));

// Mock ClaimCenter so this test focuses on the Farcaster/mobile tab wiring
vi.mock("@/components/infofi/ClaimCenter", () => ({
  default: ({ address, title, description }) => (
    <div>
      <div data-testid="claimcenter-address">{address || ""}</div>
      <div data-testid="claimcenter-title">{title || ""}</div>
      <div data-testid="claimcenter-description">{description || ""}</div>
    </div>
  ),
}));

import MobileClaimsTab from "@/components/mobile/MobileClaimsTab.jsx";

describe("MobileClaimsTab", () => {
  it("renders ClaimCenter with translated title/description", () => {
    render(
      <MobileClaimsTab address="0x1111111111111111111111111111111111111111" />,
    );

    expect(screen.getByTestId("claimcenter-title").textContent).toBe("Claims");
    expect(screen.getByTestId("claimcenter-description").textContent).toBe(
      "Claimable raffle prizes and market winnings.",
    );
  });

  it("passes address through to ClaimCenter", () => {
    render(
      <MobileClaimsTab address="0x2222222222222222222222222222222222222222" />,
    );

    expect(screen.getByTestId("claimcenter-address").textContent).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("does not crash when address is missing", () => {
    render(<MobileClaimsTab />);

    expect(screen.getByTestId("claimcenter-title").textContent).toBe("Claims");
  });
});
