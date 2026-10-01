import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TokensIndex from "@/routes/TokensIndex";
import { useTokenLaunches } from "@/hooks/useTokenLaunches";
import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";

vi.mock("@/hooks/useTokenLaunches", async () => {
  const actual = await vi.importActual("@/hooks/useTokenLaunches");
  return { ...actual, useTokenLaunches: vi.fn() };
});
vi.mock("@/hooks/useLaunchMarkets", () => ({ useLaunchMarkets: vi.fn() }));

// i18n is not initialised in this suite, so `t` returns the key — assertions
// match on keys rather than English copy.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts?.value != null ? `${key}:${opts.value}` : key) }),
}));

const ONE_ETH = 10n ** 18n;
const NOW = Math.floor(Date.now() / 1000);

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";

const launches = [
  { launchId: 2, token: C, name: "Gamma", symbol: "GAM", launchedAt: BigInt(NOW - 60), placementId: "0xc" },
  { launchId: 1, token: B, name: "Beta", symbol: "BET", launchedAt: BigInt(NOW - 3600), placementId: "0xb" },
  { launchId: 0, token: A, name: "Alpha", symbol: "ALP", launchedAt: BigInt(NOW - 86400), placementId: "0xa" },
];

const markets = {
  [A]: { fdvWei: 50n * ONE_ETH, multiple: 25, soldFraction: 0.7 },
  [B]: { fdvWei: 90n * ONE_ETH, multiple: 3, soldFraction: 0.2 },
  [C]: { fdvWei: 2n * ONE_ETH, multiple: 1.2, soldFraction: 0.05 },
};

const setup = ({ list = launches, isLoading = false, isAvailable = true, priced = markets } = {}) => {
  useTokenLaunches.mockReturnValue({ launches: list, total: list.length, isLoading, isAvailable });
  useLaunchMarkets.mockReturnValue({ markets: priced, isLoading: false, isAvailable: true });
  return render(
    <MemoryRouter>
      <TokensIndex />
    </MemoryRouter>,
  );
};

/** Card names in DOM order. */
const cardOrder = () =>
  screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/tokens/"))
    .map((a) => a.getAttribute("href").split("/").pop());

describe("TokensIndex", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a card per launch with its live valuation, multiple and supply sold", () => {
    setup();
    const alpha = screen.getByRole("link", { name: /Alpha/ });
    expect(within(alpha).getByText("50")).toBeInTheDocument();
    expect(within(alpha).getByText("card.multiple:25.0")).toBeInTheDocument();
    expect(within(alpha).getByText("card.sold:70")).toBeInTheDocument();
  });

  it("links each card to its token page", () => {
    setup();
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute("href", `/tokens/${A}`);
  });

  it("shows a placeholder, not a zero valuation, while a token is still being priced", () => {
    setup({ priced: {} });
    const alpha = screen.getByRole("link", { name: /Alpha/ });
    expect(within(alpha).queryByText("card.valuation")).not.toBeInTheDocument();
    expect(within(alpha).getByLabelText("card.pricing")).toBeInTheDocument();
  });

  it("defaults to newest first", () => {
    setup();
    expect(cardOrder()).toEqual([C, B, A]);
  });

  it("re-sorts by biggest climb, top FDV and near sellout", () => {
    setup();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "sort.climb" }));
    fireEvent.click(screen.getByRole("tab", { name: "sort.climb" }));
    expect(cardOrder()).toEqual([A, B, C]);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "sort.fdv" }));
    fireEvent.click(screen.getByRole("tab", { name: "sort.fdv" }));
    expect(cardOrder()).toEqual([B, A, C]);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "sort.sellout" }));
    fireEvent.click(screen.getByRole("tab", { name: "sort.sellout" }));
    expect(cardOrder()).toEqual([A, B, C]);
  });

  it("filters by name, ticker (with or without $) and address", () => {
    setup();
    const search = screen.getByRole("searchbox", { name: "search.label" });

    fireEvent.change(search, { target: { value: "bet" } });
    expect(cardOrder()).toEqual([B]);

    fireEvent.change(search, { target: { value: "$gam" } });
    expect(cardOrder()).toEqual([C]);

    fireEvent.change(search, { target: { value: "0x1111" } });
    expect(cardOrder()).toEqual([A]);
  });

  it("says so when a search matches nothing", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "search.label" }), { target: { value: "zzz" } });
    expect(screen.getByText("search.noResults")).toBeInTheDocument();
  });

  it("switches to the list view", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "layout.list" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "layout.list" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the launch count, and a launch fee of none rather than an unbuilt fee split", () => {
    setup();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("stats.launchFeeValue")).toBeInTheDocument();
    // The 88% creator share is decided but not yet routed on-chain (Phase 3);
    // the live page must not claim it.
    expect(screen.queryByText(/88/)).not.toBeInTheDocument();
  });

  it("offers a launch call to action when nothing has launched yet", () => {
    setup({ list: [] });
    expect(screen.getByText("list.empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "list.emptyCta" })).toHaveAttribute("href", "/launch");
  });

  it("explains itself when the network has no launchpad", () => {
    setup({ isAvailable: false });
    expect(screen.getByText("unavailable.title")).toBeInTheDocument();
  });

  it("shows skeletons while loading rather than an empty state", () => {
    setup({ list: [], isLoading: true });
    expect(screen.queryByText("list.empty")).not.toBeInTheDocument();
  });
});
