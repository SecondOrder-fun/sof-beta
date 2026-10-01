import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import CreatorFeesSection from "@/components/launchpad/CreatorFeesSection";
import { UniV4LiquidityPlacerAbi } from "@/utils/abis";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, opts) =>
      opts ? `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(",")})` : key,
  }),
}));

const SMA = getAddress("0x5555555555555555555555555555555555555555");
const OTHER = getAddress("0x7777777777777777777777777777777777777777");
const PLACER = getAddress("0x3000000000000000000000000000000000000003");
const POND = getAddress("0xaaaa00000000000000000000000000000000aaaa");
const LAMP = getAddress("0xbbbb00000000000000000000000000000000bbbb");
const MOSS = getAddress("0xcccc00000000000000000000000000000000cccc");
const GONE = getAddress("0xdddd00000000000000000000000000000000dddd");
const E = 10n ** 18n;
const lc = (a) => a.toLowerCase();

vi.mock("@/hooks/useRaffleAccount", () => ({ useRaffleAccount: () => ({ eoa: SMA, sma: SMA }) }));

const created = { current: [] };
vi.mock("@/hooks/useLaunchActivity", () => ({
  useCreatorLaunches: () => ({ launches: created.current, isLoading: false, isError: false }),
}));
const fees = { current: undefined };
const write = { send: vi.fn(), reset: vi.fn(), isPending: false, error: null };
vi.mock("@/hooks/useCreatorFees", () => ({
  useCreatorFees: () => ({ data: fees.current }),
  useCreatorFeeWrite: () => write,
}));
vi.mock("@/hooks/useLaunchMarkets", () => ({
  // 1 POND = 1e-7 ETH (100 gwei)
  useLaunchMarkets: () => ({ markets: { [lc(POND)]: { priceWei: 100_000_000_000n } } }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/networks", () => ({ getNetworkByKey: () => ({ explorer: "https://sepolia.basescan.org" }) }));

const meta = (token, name, symbol) => ({ token, name, symbol, poolId: `0x${"ab".repeat(32)}`, creator: lc(SMA) });
const launchFees = (token, over = {}) => ({
  token,
  placer: PLACER,
  recipient: SMA,
  claimableToken: {},
  uncollectedEth: 0n,
  uncollectedTokens: 0n,
  ...over,
});

const decode = (calls) =>
  calls.map(({ data }) => {
    const { functionName, args } = decodeFunctionData({ abi: UniV4LiquidityPlacerAbi, data });
    return [functionName, ...(args ?? [])];
  });

const setup = () =>
  render(
    <MemoryRouter>
      <CreatorFeesSection />
    </MemoryRouter>,
  );

describe("CreatorFeesSection", () => {
  beforeEach(() => {
    created.current = [
      meta(POND, "Frog Pond", "POND"),
      meta(LAMP, "Night Lamp", "LAMP"),
      meta(MOSS, "Moss Bank", "MOSS"),
      meta(GONE, "Gone Fishing", "GONE"),
    ];
    fees.current = {
      launches: [
        launchFees(POND, { uncollectedEth: E / 10n, claimableToken: { [lc(SMA)]: 1_000_000n * E }, uncollectedTokens: 500_000n * E }),
        // handed on, but tokens credited before the transfer are still here
        launchFees(LAMP, { recipient: OTHER, uncollectedEth: E, claimableToken: { [lc(SMA)]: 880_000n * E } }),
        launchFees(MOSS),
        // handed on with nothing left: not listed
        launchFees(GONE, { recipient: OTHER, uncollectedEth: E }),
      ],
      placers: { [lc(PLACER)]: { address: PLACER, creatorFeeBps: 8800n, claimableEth: { [lc(SMA)]: E / 2n } } },
    };
    write.send = vi.fn().mockResolvedValue("0xhash");
    write.isPending = false;
    write.error = null;
  });

  it("renders nothing for an account with no launches", () => {
    created.current = [];
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing until the fees are read", () => {
    fees.current = undefined;
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every launch was handed on and nothing is left", () => {
    created.current = [meta(GONE, "Gone Fishing", "GONE")];
    fees.current = {
      launches: [launchFees(GONE, { recipient: OTHER, uncollectedEth: E })],
      placers: { [lc(PLACER)]: { address: PLACER, creatorFeeBps: 8800n, claimableEth: {} } },
    };
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("totals pooled and in-pool ETH across the launches it lists", () => {
    setup();
    expect(screen.getByRole("region", { name: "creatorFees.profile.title" })).toBeInTheDocument();
    // 0.5 credited + 88% of POND's 0.1 = 0.588
    expect(screen.getByText("creatorFees.profile.ethAcross(count=3)")).toBeInTheDocument();
    expect(screen.getByText("0.58")).toBeInTheDocument();
    expect(
      screen.getByText("creatorFees.profile.ethBreakdown(collected=0.5,inPool=0.08)"),
    ).toBeInTheDocument();
    expect(screen.getByText("creatorFees.profile.footnote")).toBeInTheDocument();
  });

  it("lists each launch with its pool ETH, token fees and their ETH value", () => {
    setup();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const [pond, lamp, moss] = rows;

    expect(within(pond).getByText("Frog Pond")).toBeInTheDocument();
    expect(within(pond).getByText("0.08")).toBeInTheDocument();
    expect(within(pond).getByText("1.44M POND")).toBeInTheDocument();
    // 1.44M POND at 1e-7 ETH = 0.144 ETH
    expect(within(pond).getByText("creatorFees.tokensEth(eth=0.14)")).toBeInTheDocument();
    expect(within(pond).getByRole("button", { name: "creatorFees.profile.claimSymbol(symbol=POND)" })).toBeEnabled();

    // Fees now go elsewhere: its pool ETH is not ours, but credited tokens are.
    expect(within(lamp).getByText("creatorFees.profile.handedOn")).toBeInTheDocument();
    expect(within(lamp).getByText("880K LAMP")).toBeInTheDocument();
    expect(within(lamp).queryByText("0.88")).not.toBeInTheDocument();

    expect(within(moss).getByText("creatorFees.profile.noFees")).toBeInTheDocument();
    expect(within(moss).getByRole("button", { name: "creatorFees.profile.nothingYet" })).toBeDisabled();
  });

  it("claims all ETH: collects the pools holding ETH for us, then one claimEth", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "creatorFees.profile.claimAllEth" }));
    await waitFor(() => expect(write.send).toHaveBeenCalled());
    const [[batches]] = write.send.mock.calls;
    expect(batches).toHaveLength(1);
    expect(batches[0].sender).toEqual({ account: SMA, mode: "smart" });
    // LAMP's pool ETH now belongs to another recipient: not collected here.
    expect(decode(batches[0].calls)).toEqual([
      ["collectFees", POND],
      ["claimEth", SMA],
    ]);
    const status = await screen.findByRole("status");
    expect(within(status).getByText("creatorFees.claimedEth(eth=0.58)")).toBeInTheDocument();
  });

  it("claims one launch's token fees from its row", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "creatorFees.profile.claimSymbol(symbol=LAMP)" }));
    await waitFor(() => expect(write.send).toHaveBeenCalled());
    const [[batches]] = write.send.mock.calls;
    expect(decode(batches[0].calls)).toEqual([["claimToken", LAMP, SMA]]);
    expect(await screen.findByText("creatorFees.claimedTokens(tokens=880K,symbol=LAMP)")).toBeInTheDocument();
  });

  it("collects a row's pool first when it holds tokens for us", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "creatorFees.profile.claimSymbol(symbol=POND)" }));
    await waitFor(() => expect(write.send).toHaveBeenCalled());
    const [[batches]] = write.send.mock.calls;
    expect(decode(batches[0].calls)).toEqual([
      ["collectFees", POND],
      ["claimToken", POND, SMA],
    ]);
  });

  it("disables Claim all ETH with no ETH to claim", () => {
    fees.current.placers[lc(PLACER)].claimableEth = {};
    fees.current.launches[0].uncollectedEth = 0n;
    setup();
    expect(screen.getByRole("button", { name: "creatorFees.profile.claimAllEth" })).toBeDisabled();
  });
});
