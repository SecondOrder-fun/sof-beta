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

const WALLET = getAddress("0x5555555555555555555555555555555555555555");
const OTHER = getAddress("0x7777777777777777777777777777777777777777");
const PLACER = getAddress("0x3000000000000000000000000000000000000003");
const POND = getAddress("0xaaaa00000000000000000000000000000000aaaa");
const LAMP = getAddress("0xbbbb00000000000000000000000000000000bbbb");
const MOSS = getAddress("0xcccc00000000000000000000000000000000cccc");
const GONE = getAddress("0xdddd00000000000000000000000000000000dddd");
const SNAIL = getAddress("0xeeee00000000000000000000000000000000eeee");
const E = 10n ** 18n;
const lc = (a) => a.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const QUOTES = {
  [ZERO]: { address: ZERO, symbol: "ETH", decimals: 18 },
  [lc(USDC)]: { address: USDC, symbol: "USDC", decimals: 6 },
};

const account = { current: { address: WALLET } };
vi.mock("wagmi", () => ({ useAccount: () => account.current }));

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
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/networks", () => ({ getNetworkByKey: () => ({ explorer: "https://sepolia.basescan.org" }) }));

// Launch rows in the backend's API shape, which carries each launch's tradeFee (pips).
const meta = (token, name, symbol, tradeFee = 10_000) => ({
  token,
  name,
  symbol,
  poolId: `0x${"ab".repeat(32)}`,
  creator: lc(WALLET),
  tradeFee,
});
const launchFees = (token, over = {}) => ({
  token,
  placer: PLACER,
  quoteToken: ZERO,
  recipient: WALLET,
  pendingFees: 0n,
  ...over,
});
const placerFees = (eth = {}, usdc = {}) => ({
  address: PLACER,
  creatorFeeBps: 8800n,
  claimable: { [ZERO]: eth, [lc(USDC)]: usdc },
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
    account.current = { address: WALLET };
    created.current = [
      meta(POND, "Frog Pond", "POND"),
      meta(LAMP, "Night Lamp", "LAMP"),
      meta(MOSS, "Moss Bank", "MOSS", 25_000),
      meta(GONE, "Gone Fishing", "GONE"),
    ];
    fees.current = {
      launches: [
        launchFees(POND, { pendingFees: E / 10n }),
        launchFees(LAMP, { pendingFees: E / 100n }),
        launchFees(MOSS),
        // handed on: not listed (what was collected for us is in the ETH total)
        launchFees(GONE, { recipient: OTHER, pendingFees: E }),
      ],
      placers: { [lc(PLACER)]: placerFees({ [lc(WALLET)]: E / 2n }) },
      quotes: QUOTES,
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
      launches: [launchFees(GONE, { recipient: OTHER, pendingFees: E })],
      placers: { [lc(PLACER)]: placerFees() },
      quotes: QUOTES,
    };
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("totals collected and pending ETH across the ETH-paired launches it lists", () => {
    setup();
    expect(screen.getByRole("region", { name: "creatorFees.profile.title" })).toBeInTheDocument();
    // 0.5 credited + 88% of POND's 0.1 + 88% of LAMP's 0.01 = 0.5968
    expect(screen.getByText("creatorFees.profile.quoteAcross(count=3,quote=ETH)")).toBeInTheDocument();
    expect(screen.getByText("0.59")).toBeInTheDocument();
    expect(
      screen.getByText("creatorFees.profile.quoteBreakdown(collected=0.5,pending=0.09,quote=ETH)"),
    ).toBeInTheDocument();
    expect(screen.getByText("creatorFees.profile.footnote")).toBeInTheDocument();
  });

  it("lists each launch with its trade fee and its pending quote — no token-fee column or per-launch claim", () => {
    setup();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const [pond, lamp, moss] = rows;

    expect(within(pond).getByText("Frog Pond")).toBeInTheDocument();
    expect(within(pond).getByText("1%")).toBeInTheDocument();
    expect(within(pond).getByText("0.08 ETH")).toBeInTheDocument();
    expect(within(lamp).getByText("0.0088 ETH")).toBeInTheDocument();
    expect(within(moss).getByText("2.5%")).toBeInTheDocument();
    expect(within(moss).getByText("—")).toBeInTheDocument();
    for (const row of rows) expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Gone Fishing")).not.toBeInTheDocument();
  });

  it("claims all ETH: collects each launch with ETH pending for us, then one claim(ETH)", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "creatorFees.profile.claimAllQuote(quote=ETH)" }));
    await waitFor(() => expect(write.send).toHaveBeenCalled());
    const [[calls]] = write.send.mock.calls;
    // GONE's pending ETH now belongs to another recipient: not collected here.
    expect(decode(calls)).toEqual([
      ["collectFees", POND],
      ["collectFees", LAMP],
      ["claim", ZERO, WALLET],
    ]);
    const status = await screen.findByRole("status");
    expect(within(status).getByText("creatorFees.claimedQuote(amount=0.59,quote=ETH)")).toBeInTheDocument();
    expect(within(status).getByText("creatorFees.claimedBody(address=0x5555…5555)")).toBeInTheDocument();
  });

  it("disables Claim all ETH with no ETH to claim", () => {
    fees.current.placers[lc(PLACER)].claimable[ZERO] = {};
    fees.current.launches[0].pendingFees = 0n;
    fees.current.launches[1].pendingFees = 0n;
    setup();
    expect(screen.getByRole("button", { name: "creatorFees.profile.claimAllQuote(quote=ETH)" })).toBeDisabled();
  });

  // A creator with an ETH launch and a USDC launch gets one total and one
  // "Claim all" per currency, each claiming only its own currency.
  it("totals and claims each quote currency apart", async () => {
    created.current = [...created.current, meta(SNAIL, "Snail Mail", "SNAIL")];
    fees.current.launches.push(launchFees(SNAIL, { quoteToken: USDC, pendingFees: 10_000_000n }));
    fees.current.placers[lc(PLACER)].claimable[lc(USDC)] = { [lc(WALLET)]: 1_200_000n };
    setup();

    // 1.2 credited + 88% of 10 = 10 USDC
    expect(screen.getByText("creatorFees.profile.quoteAcross(count=1,quote=USDC)")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    const snail = screen.getAllByRole("row").find((r) => within(r).queryByText("Snail Mail"));
    expect(within(snail).getByText("8.8 USDC")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "creatorFees.profile.claimAllQuote(quote=USDC)" }));
    await waitFor(() => expect(write.send).toHaveBeenCalled());
    expect(decode(write.send.mock.calls[0][0])).toEqual([
      ["collectFees", SNAIL],
      ["claim", USDC, WALLET],
    ]);
    expect(await screen.findByText("creatorFees.claimedQuote(amount=10,quote=USDC)")).toBeInTheDocument();
    // The ETH button is still there, for ETH alone.
    expect(screen.getByRole("button", { name: "creatorFees.profile.claimAllQuote(quote=ETH)" })).toBeInTheDocument();
  });
});
