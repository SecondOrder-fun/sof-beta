import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import CreatorFeesCard from "@/components/launchpad/CreatorFeesCard";
import { UniV4LiquidityPlacerAbi } from "@/utils/abis";
import { deriveMarketState } from "@/lib/v4PoolMath";

// Keys with their interpolations, so a test reads which string and which numbers.
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
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const E = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const QUOTES = {
  [ZERO]: { address: ZERO, symbol: "ETH", decimals: 18 },
  [USDC.toLowerCase()]: { address: USDC, symbol: "USDC", decimals: 6 },
};

const account = { current: { address: WALLET } };
vi.mock("wagmi", () => ({ useAccount: () => account.current }));

const fees = { current: undefined };
const write = { send: vi.fn(), reset: vi.fn(), isPending: false, error: null };
vi.mock("@/hooks/useCreatorFees", () => ({
  useCreatorFees: () => ({ data: fees.current }),
  useCreatorFeeWrite: () => write,
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ explorer: "https://sepolia.basescan.org/" }),
}));

// The launch state from test_fixture_quoteMathForFrontend (a 1% trade fee).
const market = deriveMarketState({
  slot0Word: "0x0000000000000000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  liquidityWord: "0x0",
  placement: { tickLower: -887200, tickUpper: 207200, liquidity: 31690866724818211737594n, tradeFee: 10_000 },
  wholeSupply: 1_000_000_000n,
  quote: QUOTES[ZERO],
});

const setFees = ({ recipient = WALLET, quoteToken = ZERO, eth = {}, usdc = {}, pendingFees = 0n } = {}) => {
  fees.current = {
    launches: [{ token: TOKEN, placer: PLACER, quoteToken, recipient, pendingFees }],
    placers: {
      [PLACER.toLowerCase()]: {
        address: PLACER,
        creatorFeeBps: 8800n,
        claimable: { [ZERO]: eth, [USDC.toLowerCase()]: usdc },
      },
    },
    quotes: QUOTES,
  };
};

const lc = (a) => a.toLowerCase();
const decode = (calls) =>
  calls.map(({ data }) => {
    const { functionName, args } = decodeFunctionData({ abi: UniV4LiquidityPlacerAbi, data });
    return [functionName, ...(args ?? [])];
  });

const setup = () => render(<CreatorFeesCard token={TOKEN} name="Frog Pond" symbol="POND" market={market} />);

describe("CreatorFeesCard", () => {
  beforeEach(() => {
    account.current = { address: WALLET };
    fees.current = undefined;
    write.send = vi.fn().mockResolvedValue("0xhash");
    write.isPending = false;
    write.error = null;
  });

  it("renders nothing while the fees load", () => {
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for anyone but the fee recipient", () => {
    setFees({ recipient: OTHER, eth: { [lc(WALLET)]: E } });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no wallet connected", () => {
    account.current = { address: undefined };
    setFees({ eth: { [lc(WALLET)]: E } });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("matches the recipient case-insensitively", () => {
    account.current = { address: WALLET.toLowerCase() };
    setFees({ eth: { [lc(WALLET)]: E } });
    setup();
    expect(screen.getByRole("region", { name: "creatorFees.title" })).toBeInTheDocument();
  });

  it("shows what the recipient earned, all in the quote: credited plus their 88% of what is pending", () => {
    // 0.1 ETH credited + 88% of 0.05 pending = 0.144 (shown to two decimals)
    setFees({ eth: { [lc(WALLET)]: E / 10n }, pendingFees: E / 20n });
    setup();

    expect(screen.getByRole("region", { name: "creatorFees.title" })).toBeInTheDocument();
    expect(screen.getByText("creatorFees.shareBadge(share=88,fee=1)")).toBeInTheDocument();
    expect(screen.getByText("creatorFees.earned")).toBeInTheDocument();
    expect(screen.getByText("creatorFees.pendingQuote(amount=0.04,quote=ETH)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "creatorFees.claimQuote(amount=0.14,quote=ETH)" })).toBeEnabled();
    expect(screen.getByText("creatorFees.captionSent")).toBeInTheDocument();
    expect(screen.getByText("creatorFees.you")).toBeInTheDocument();
    // No launch-token side any more.
    expect(screen.queryByText(/POND/)).not.toBeInTheDocument();
  });

  it("shows the launch's own trade fee rate", () => {
    setFees({ eth: { [lc(WALLET)]: E } });
    render(<CreatorFeesCard token={TOKEN} name="Frog Pond" symbol="POND" market={{ ...market, tradeFee: 25_000 }} />);
    expect(screen.getByText("creatorFees.shareBadge(share=88,fee=2.5)")).toBeInTheDocument();
  });

  it("leaves out the pending line when everything is already collected", () => {
    setFees({ eth: { [lc(WALLET)]: E } });
    setup();
    expect(screen.queryByText(/creatorFees\.pendingQuote/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "creatorFees.claimQuote(amount=1,quote=ETH)" })).toBeEnabled();
  });

  it("claims in one batch from the connected wallet: collect, then claim ETH", async () => {
    setFees({ eth: { [lc(WALLET)]: E }, pendingFees: 100n * E });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^creatorFees\.claimQuote/ }));

    await waitFor(() => expect(write.send).toHaveBeenCalledTimes(1));
    const [[calls]] = write.send.mock.calls;
    expect(decode(calls)).toEqual([
      ["collectFees", TOKEN],
      ["claim", ZERO, WALLET],
    ]);

    const status = await screen.findByRole("status");
    expect(within(status).getByText("creatorFees.claimedQuote(amount=89,quote=ETH)")).toBeInTheDocument();
    expect(within(status).getByRole("link", { name: "creatorFees.viewTransaction" })).toHaveAttribute(
      "href",
      "https://sepolia.basescan.org/tx/0xhash",
    );
  });

  // A USDC-paired launch earns its fees in USDC: shown in USDC's 6 decimals and
  // claimed with claim(USDC), never as ETH.
  it("shows and claims a USDC-paired launch's fees in USDC", async () => {
    setFees({ quoteToken: USDC, eth: { [lc(WALLET)]: E }, usdc: { [lc(WALLET)]: 2_500_000n }, pendingFees: 1_000_000n });
    setup();
    // 2.5 credited + 88% of 1 = 3.38 USDC; the 1 ETH credited elsewhere is not this launch's.
    expect(screen.getByText("creatorFees.quotePooled(quote=USDC)")).toBeInTheDocument();
    expect(screen.getByText("creatorFees.pendingQuote(amount=0.88,quote=USDC)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "creatorFees.claimQuote(amount=3.38,quote=USDC)" }));
    await waitFor(() => expect(write.send).toHaveBeenCalledTimes(1));
    expect(decode(write.send.mock.calls[0][0])).toEqual([
      ["collectFees", TOKEN],
      ["claim", USDC, WALLET],
    ]);
  });

  it("with no fees yet, says how they are earned and disables the button", () => {
    setFees();
    setup();
    expect(
      screen.getByText("creatorFees.emptyBody(share=88,fee=1,name=Frog Pond,quote=ETH)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "creatorFees.nothingToClaim" })).toBeDisabled();
    // The recipient can still hand fees on before any arrive.
    expect(screen.getByRole("button", { name: "creatorFees.transfer" })).toBeEnabled();
  });

  it("reports a failed claim", () => {
    setFees({ eth: { [lc(WALLET)]: E } });
    write.error = new Error("user rejected");
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent("creatorFees.failed: user rejected");
  });

  describe("Transfer", () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: "creatorFees.transfer" }));
      return screen.getByRole("dialog");
    };
    const field = () => screen.getByLabelText("creatorFees.transferDialog.label");
    const submit = () => screen.getByRole("button", { name: "creatorFees.transferDialog.submit" });

    it("explains what moves and what stays", () => {
      setFees();
      setup();
      const dialog = openDialog();
      expect(within(dialog).getByText("creatorFees.transferDialog.title(name=Frog Pond)")).toBeInTheDocument();
      expect(within(dialog).getByText("creatorFees.transferDialog.body")).toBeInTheDocument();
    });

    it("blocks an address that is not one, and says so once the field is left", () => {
      setFees();
      setup();
      openDialog();
      fireEvent.change(field(), { target: { value: "0x7a3c…05d1" } });
      expect(submit()).toBeDisabled();
      expect(screen.queryByText("creatorFees.transferDialog.errors.invalid")).not.toBeInTheDocument();
      fireEvent.blur(field());
      expect(screen.getByText("creatorFees.transferDialog.errors.invalid")).toBeInTheDocument();
      expect(field()).toHaveAttribute("aria-invalid", "true");
    });

    it("blocks the zero address and the current recipient", () => {
      setFees();
      setup();
      openDialog();
      fireEvent.change(field(), { target: { value: `0x${"0".repeat(40)}` } });
      fireEvent.blur(field());
      expect(screen.getByText("creatorFees.transferDialog.errors.zero")).toBeInTheDocument();
      fireEvent.change(field(), { target: { value: WALLET.toLowerCase() } });
      expect(screen.getByText("creatorFees.transferDialog.errors.same")).toBeInTheDocument();
      expect(submit()).toBeDisabled();
    });

    it("collects first, then hands future fees on, and says where they go", async () => {
      setFees({ pendingFees: E });
      setup();
      openDialog();
      fireEvent.change(field(), { target: { value: OTHER.toLowerCase() } });
      expect(submit()).toBeEnabled();
      fireEvent.click(submit());

      await waitFor(() => expect(write.send).toHaveBeenCalled());
      const [[calls]] = write.send.mock.calls;
      expect(decode(calls)).toEqual([
        ["collectFees", TOKEN],
        ["setFeeRecipient", TOKEN, OTHER],
      ]);
      expect(await screen.findByText("creatorFees.transferred(name=Frog Pond,address=0x7777…7777)")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("can't be closed, or opened again, while a transfer is in flight", () => {
      setFees();
      const { rerender } = setup();
      openDialog();
      write.isPending = true;
      rerender(<CreatorFeesCard token={TOKEN} name="Frog Pond" symbol="POND" market={market} />);

      expect(screen.getByRole("button", { name: "creatorFees.transferDialog.cancel" })).toBeDisabled();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // The card's own Transfer button is disabled too, so reset() can't detach it.
      expect(screen.getByRole("button", { name: "creatorFees.transfer", hidden: true })).toBeDisabled();
    });

    it("cancels without sending", () => {
      setFees();
      setup();
      openDialog();
      fireEvent.click(screen.getByRole("button", { name: "creatorFees.transferDialog.cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(write.send).not.toHaveBeenCalled();
    });
  });
});
