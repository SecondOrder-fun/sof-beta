// tests/routes/CreateSeasonPage.quoteToken.test.jsx
// /create-season?quoteToken=0x… hands the token to whichever flow renders, to
// preselect (after the eligibility check) as the season's quote token.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import CreateSeasonPage from "@/routes/CreateSeasonPage";
import { usePlatform } from "@/hooks/usePlatform";

vi.mock("@/hooks/usePlatform", () => ({ usePlatform: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));
vi.mock("@/components/sponsor/CreateSeasonWorkflow", () => ({
  CreateSeasonWorkflow: ({ initialQuoteToken }) => <div data-testid="desktop">{initialQuoteToken ?? "none"}</div>,
}));
vi.mock("@/components/mobile/MobileCreateSeason", () => ({
  default: ({ initialQuoteToken }) => <div data-testid="mobile">{initialQuoteToken ?? "none"}</div>,
}));

const POND = "0x1111111111111111111111111111111111111111";

const renderAt = (url, platform = {}) => {
  usePlatform.mockReturnValue({ isMobile: false, isMobileBrowser: false, ...platform });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CreateSeasonPage />
    </MemoryRouter>,
  );
};

describe("CreateSeasonPage ?quoteToken=", () => {
  it("hands the token to the desktop flow", () => {
    renderAt(`/create-season?quoteToken=${POND}`);
    expect(screen.getByTestId("desktop")).toHaveTextContent(POND);
  });

  it("hands the token to the mobile flow", () => {
    renderAt(`/create-season?quoteToken=${POND}`, { isMobileBrowser: true });
    expect(screen.getByTestId("mobile")).toHaveTextContent(POND);
  });

  it("hands nothing without the param", () => {
    renderAt("/create-season");
    expect(screen.getByTestId("desktop")).toHaveTextContent("none");
  });
});
