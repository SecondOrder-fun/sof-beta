/*
  @vitest-environment jsdom
*/
// tests/components/CreateSeasonForm.quoteToken.test.jsx
// The desktop form creates the season in the token chosen under "Priced in",
// and will not submit one the contract would reject.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import CreateSeasonForm from "@/components/admin/CreateSeasonForm";
import { useQuoteTokenChoice } from "@/hooks/useQuoteTokenChoice";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("wagmi", () => ({
  usePublicClient: () => ({
    readContract: vi.fn().mockResolvedValue(18),
    getBlock: vi.fn().mockResolvedValue({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
  }),
  useAccount: () => ({ address: "0x123" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key), i18n: { language: "en" } }),
}));
vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: vi.fn(), isSmartWallet: false }),
}));
vi.mock("@/hooks/useQuoteTokenChoice", () => ({ useQuoteTokenChoice: vi.fn() }));
// The picker has its own tests; here it only has to show which token is chosen.
vi.mock("@/components/admin/QuoteTokenPicker", () => ({
  default: ({ choice }) => <div data-testid="picker">{choice.selected?.symbol ?? "none"}</div>,
}));

const POND = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";

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

const renderForm = (createSeason, props = {}) =>
  render(
    <CreateSeasonForm
      createSeason={createSeason}
      chainTimeQuery={{ data: Math.floor(Date.now() / 1000), isLoading: false }}
      {...props}
    />,
  );

const fillRequired = () => {
  fireEvent.change(screen.getByPlaceholderText("seasonNamePlaceholder"), { target: { value: "Frog Fest" } });
  fireEvent.change(screen.getByPlaceholderText("0x..."), { target: { value: TREASURY } });
};

describe("CreateSeasonForm — Priced in", () => {
  let createSeason;
  beforeEach(() => {
    vi.clearAllMocks();
    createSeason = { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, isConfirmed: false, error: null };
  });

  it("creates the season in the chosen token", async () => {
    useQuoteTokenChoice.mockReturnValue(chosen());
    renderForm(createSeason);
    fillRequired();
    const submit = screen.getByRole("button", { name: "createSeasonBtn" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    // The confirmation names the token before anything is signed.
    expect(await screen.findByText('quoteToken.symbol{"symbol":"POND"}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "confirmSignBtn" }));
    expect(createSeason.mutate).toHaveBeenCalledTimes(1);
    expect(createSeason.mutate.mock.calls[0][0].config.quoteToken).toBe(POND);
  });

  it("labels the curve's prices in the chosen token, not SOF", () => {
    useQuoteTokenChoice.mockReturnValue(chosen());
    renderForm(createSeason, { activeSection: "curve" });
    expect(screen.getByText('curveEditor.initialPrice{"symbol":"POND"}')).toBeInTheDocument();
    expect(screen.queryByText(/\(SOF\)/)).not.toBeInTheDocument();
    // A launch token's pool price gives the first ticket an ETH equivalent:
    // 10 POND at 47 gwei = 0.00000047 ETH.
    expect(screen.getByText('quoteToken.ethEquivalent{"eth":"0.00000047"}')).toBeInTheDocument();
  });

  it("gives no ETH equivalent for a token with no pool", () => {
    useQuoteTokenChoice.mockReturnValue(
      chosen({ selected: { address: POND, name: "Second Order", symbol: "SOF", decimals: 18, kind: "approved", isPlatformDefault: true } }),
    );
    renderForm(createSeason, { activeSection: "curve" });
    expect(screen.queryByText(/quoteToken\.ethEquivalent/)).not.toBeInTheDocument();
  });

  it("leaves the quote token to the write's fallback when none is chosen", async () => {
    useQuoteTokenChoice.mockReturnValue(chosen({ selected: null, quoteToken: undefined, status: "none" }));
    renderForm(createSeason);
    fillRequired();
    const submit = screen.getByRole("button", { name: "createSeasonBtn" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    fireEvent.click(await screen.findByRole("button", { name: "confirmSignBtn" }));
    expect("quoteToken" in createSeason.mutate.mock.calls[0][0].config).toBe(false);
  });

  it("will not submit a token the contract would reject", async () => {
    useQuoteTokenChoice.mockReturnValue(chosen({ selected: null, quoteToken: undefined, status: "ineligible", source: "paste", blocked: true }));
    renderForm(createSeason);
    fillRequired();
    const submit = screen.getByRole("button", { name: "createSeasonBtn" });
    expect(submit).toBeDisabled();
    // Even submitted programmatically, it stops with the reason.
    fireEvent.submit(submit.closest("form"));
    expect(await screen.findByText("quoteToken.notAllowed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "confirmSignBtn" })).not.toBeInTheDocument();
    expect(createSeason.mutate).not.toHaveBeenCalled();
  });

  it("hands the preselected token to the choice", () => {
    useQuoteTokenChoice.mockReturnValue(chosen());
    renderForm(createSeason, { initialQuoteToken: POND });
    expect(useQuoteTokenChoice).toHaveBeenCalledWith({ initialToken: POND });
  });
});
