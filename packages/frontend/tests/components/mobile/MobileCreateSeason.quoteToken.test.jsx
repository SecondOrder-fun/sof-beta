// tests/components/mobile/MobileCreateSeason.quoteToken.test.jsx
// The mobile flow creates the season in the token chosen under "Priced in",
// prices its curve presets in that token, and will not submit one the
// contract would reject.
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

import MobileCreateSeason from "@/components/mobile/MobileCreateSeason";
import { useQuoteTokenChoice } from "@/hooks/useQuoteTokenChoice";

const ME = "0x00000000000000000000000000000000000000e0";
const POND = "0x1111111111111111111111111111111111111111";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x00000000000000000000000000000000000000e0", isConnected: true }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key) }),
}));
vi.mock("@/hooks/useAppAuth", () => ({ useAppAuth: () => ({ status: "authenticated", error: null }) }));
vi.mock("@/hooks/useSponsorStaking", () => ({ useSponsorStaking: () => ({ isSponsor: true, isLoading: false }) }));
vi.mock("@/hooks/useChainTime", () => ({ useChainTime: () => Math.floor(Date.now() / 1000) }));
vi.mock("@/hooks/useSafeArea", () => ({ useSafeArea: () => ({ top: 0, bottom: 0 }) }));
vi.mock("@/hooks/useRaffleWrite", () => ({ useRaffleWrite: vi.fn() }));
vi.mock("@/hooks/useQuoteTokenChoice", () => ({ useQuoteTokenChoice: vi.fn() }));
vi.mock("@/config/contracts", () => ({ RAFFLE_ABI: [] }));
vi.mock("@/components/admin/QuoteTokenPicker", () => ({
  default: ({ choice }) => <div data-testid="picker">{choice.selected?.symbol ?? "none"}</div>,
}));

import { useRaffleWrite } from "@/hooks/useRaffleWrite";

const chosen = (over = {}) => ({
  groups: { yours: [], approved: [], newest: [] },
  selected: { address: POND, name: "Pond", symbol: "POND", decimals: 18, kind: "launch", priceWei: 47n * 10n ** 9n },
  quoteToken: POND,
  status: "eligible",
  source: "list",
  blocked: false,
  pasteText: "",
  setPasteText: vi.fn(),
  selectFromList: vi.fn(),
  ...over,
});

const renderFlow = (props = {}) =>
  render(
    <MemoryRouter>
      <MobileCreateSeason {...props} />
    </MemoryRouter>,
  );

/** Step 1 (name), then Next to step 2, where the picker and the curve are. */
const toStep2 = () => {
  fireEvent.change(screen.getAllByPlaceholderText("seasonNamePlaceholder")[0], { target: { value: "Frog Fest" } });
  fireEvent.click(screen.getByRole("button", { name: "next" }));
};

describe("MobileCreateSeason — Priced in", () => {
  let createSeason;
  beforeEach(() => {
    vi.clearAllMocks();
    createSeason = { mutate: vi.fn(), isPending: false, isError: false, isConfirmed: false, error: null };
    useRaffleWrite.mockReturnValue({ createSeason });
  });

  it("creates the season in the chosen token", () => {
    useQuoteTokenChoice.mockReturnValue(chosen());
    renderFlow();
    toStep2();
    expect(screen.getByTestId("picker")).toHaveTextContent("POND");
    fireEvent.click(screen.getByRole("button", { name: "createSeasonBtn" }));
    expect(createSeason.mutate).toHaveBeenCalledTimes(1);
    const { config } = createSeason.mutate.mock.calls[0][0];
    expect(config.quoteToken).toBe(POND);
    expect(config.treasuryAddress).toBe(ME);
  });

  it("prices the curve presets in the chosen token, with an ETH equivalent for a launch token", () => {
    useQuoteTokenChoice.mockReturnValue(chosen());
    renderFlow();
    toStep2();
    expect(screen.getAllByText(/curveEditor\.presetRange.*"symbol":"POND"/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ SOF$/)).not.toBeInTheDocument();
    // The standard preset starts at 10 POND; at 47 gwei that is 0.00000047 ETH.
    expect(screen.getAllByText('quoteToken.ethEquivalent{"eth":"0.00000047"}').length).toBeGreaterThan(0);
  });

  it("will not submit a token the contract would reject", () => {
    useQuoteTokenChoice.mockReturnValue(chosen({ selected: null, quoteToken: undefined, status: "ineligible", source: "paste", blocked: true }));
    renderFlow();
    toStep2();
    expect(screen.getByRole("button", { name: "createSeasonBtn" })).toBeDisabled();
    expect(createSeason.mutate).not.toHaveBeenCalled();
  });

  it("hands the preselected token to the choice", () => {
    useQuoteTokenChoice.mockReturnValue(chosen());
    renderFlow({ initialQuoteToken: POND });
    expect(useQuoteTokenChoice).toHaveBeenCalledWith({ initialToken: POND });
  });
});
