import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TokensIndex from "@/routes/TokensIndex";
import { useTokenLaunches } from "@/hooks/useTokenLaunches";

vi.mock("@/hooks/useTokenLaunches", async () => {
  const actual = await vi.importActual("@/hooks/useTokenLaunches");
  return { ...actual, useTokenLaunches: vi.fn() };
});

// i18n is not initialised in this suite, so `t` returns the key — assertions
// match on keys rather than English copy.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts?.count != null ? `${key}:${opts.count}` : key) }),
}));

const ONE_ETH = 10n ** 18n;

const launch = (over = {}) => ({
  launchId: 0,
  token: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  launchedAt: BigInt(Math.floor(Date.now() / 1000) - 120),
  startPriceWei: 1_000_000_000n,
  impliedFdvWei: ONE_ETH,
  name: "Second Order",
  symbol: "SOF",
  ...over,
});

const renderRoute = () =>
  render(
    <MemoryRouter>
      <TokensIndex />
    </MemoryRouter>,
  );

describe("TokensIndex", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a card per launch, with the valuation and the price", () => {
    useTokenLaunches.mockReturnValue({
      launches: [launch(), launch({ launchId: 1, token: "0x3333333333333333333333333333333333333333", name: "Other", symbol: "OTH" })],
      total: 2,
      isLoading: false,
      isAvailable: true,
    });

    renderRoute();

    expect(screen.getByText("Second Order")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    // FDV in ETH and start price in gwei — the two units the page commits to.
    expect(screen.getAllByText("1 ETH").length).toBe(2);
    expect(screen.getAllByText("1 gwei").length).toBe(2);
  });

  it("links each card to its token detail route", () => {
    useTokenLaunches.mockReturnValue({
      launches: [launch()],
      total: 1,
      isLoading: false,
      isAvailable: true,
    });

    renderRoute();

    expect(screen.getByRole("link", { name: /Second Order/ })).toHaveAttribute(
      "href",
      "/tokens/0x1111111111111111111111111111111111111111",
    );
  });

  it("offers a launch call to action when nothing has launched yet", () => {
    useTokenLaunches.mockReturnValue({ launches: [], total: 0, isLoading: false, isAvailable: true });

    renderRoute();

    expect(screen.getByText("list.empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "list.emptyCta" })).toHaveAttribute("href", "/launch");
  });

  // A chain with no launchpad is a normal state, not a failure: the raffle stack
  // deploys independently, so the page says so instead of erroring.
  it("explains itself when the network has no launchpad", () => {
    useTokenLaunches.mockReturnValue({ launches: [], total: 0, isLoading: false, isAvailable: false });

    renderRoute();

    expect(screen.getByText("unavailable.title")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "list.launchCta" })).not.toBeInTheDocument();
  });

  it("shows skeletons while loading rather than an empty state", () => {
    useTokenLaunches.mockReturnValue({ launches: [], total: 0, isLoading: true, isAvailable: true });

    renderRoute();

    expect(screen.queryByText("list.empty")).not.toBeInTheDocument();
  });
});
