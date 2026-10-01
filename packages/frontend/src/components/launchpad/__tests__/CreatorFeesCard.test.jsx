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

const SMA = getAddress("0x5555555555555555555555555555555555555555");
const EOA = getAddress("0x6666666666666666666666666666666666666666");
const OTHER = getAddress("0x7777777777777777777777777777777777777777");
const PLACER = getAddress("0x3000000000000000000000000000000000000003");
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const E = 10n ** 18n;

const accounts = { current: { eoa: SMA, sma: SMA, walletType: "desktop-eoa" } };
vi.mock("@/hooks/useRaffleAccount", () => ({ useRaffleAccount: () => accounts.current }));

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

// The launch state from test_fixture_quoteMathForFrontend (1% LP fee).
const market = deriveMarketState({
  slot0Word: "0x0000000027100000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  liquidityWord: "0x0",
  placement: { tickLower: 161200, tickUpper: 207200, liquidity: 35222655548218972599314n },
  wholeSupply: 1_000_000_000n,
});

const setFees = ({
  recipient = SMA,
  eth = {},
  tokens = {},
  uncollectedEth = 0n,
  uncollectedTokens = 0n,
  isCurrent = true,
} = {}) => {
  fees.current = {
    launches: [
      {
        token: TOKEN,
        placer: PLACER,
        recipient,
        claimableToken: tokens,
        uncollectedEth,
        uncollectedTokens,
      },
    ],
    placers: { [PLACER.toLowerCase()]: { address: PLACER, creatorFeeBps: 8800n, claimableEth: eth, isCurrent } },
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
    accounts.current = { eoa: EOA, sma: SMA, walletType: "desktop-eoa" };
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
    setFees({ recipient: OTHER, eth: { [lc(SMA)]: E } });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows what the recipient earned: credited plus their 88% of what is still in the pool", () => {
    // 0.1 ETH credited + 88% of 0.05 in the pool = 0.144; 1M + 88% of 500K = 1.44M
    setFees({
      eth: { [lc(SMA)]: E / 10n },
      tokens: { [lc(SMA)]: 1_000_000n * E },
      uncollectedEth: E / 20n,
      uncollectedTokens: 500_000n * E,
    });
    setup();

    expect(screen.getByRole("region", { name: "creatorFees.title" })).toBeInTheDocument();
    expect(screen.getByText("creatorFees.shareBadge(share=88,fee=1)")).toBeInTheDocument();
    expect(screen.getByText("1.44M")).toBeInTheDocument();
    expect(screen.getByText(/^creatorFees\.tokensEth\(eth=/)).toBeInTheDocument();
    expect(
      screen.getByText("creatorFees.inPoolBoth(eth=0.04,tokens=440K,symbol=POND)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "creatorFees.claimBoth(eth=0.14,tokens=1.44M,symbol=POND)" }),
    ).toBeEnabled();
    expect(screen.getByText("creatorFees.captionSponsored")).toBeInTheDocument();
    expect(screen.getByText("creatorFees.you")).toBeInTheDocument();
  });

  // Coinbase Smart Wallet batches go through other paymasters, optionally; a
  // replaced placer is not sponsored by SOFPaymaster.
  it("does not promise a gas-free claim where SOFPaymaster is not known to pay", () => {
    accounts.current = { eoa: SMA, sma: SMA, walletType: "coinbase-smart" };
    setFees({ eth: { [lc(SMA)]: E } });
    const { unmount } = setup();
    expect(screen.getByText("creatorFees.captionSent")).toBeInTheDocument();
    unmount();

    accounts.current = { eoa: EOA, sma: SMA, walletType: "desktop-eoa" };
    setFees({ eth: { [lc(SMA)]: E }, isCurrent: false });
    setup();
    expect(screen.getByText("creatorFees.captionSent")).toBeInTheDocument();
    expect(screen.queryByText("creatorFees.captionSponsored")).not.toBeInTheDocument();
  });

  it("leaves out the pool line when everything is already collected", () => {
    setFees({ eth: { [lc(SMA)]: E } });
    setup();
    expect(screen.queryByText(/creatorFees\.inPool/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "creatorFees.claimEth(eth=1,tokens=0,symbol=POND)" })).toBeEnabled();
  });

  it("names only the token when only token fees are earned", () => {
    setFees({ tokens: { [lc(SMA)]: 2_000n * E } });
    setup();
    expect(screen.getByRole("button", { name: "creatorFees.claimTokens(eth=0,tokens=2K,symbol=POND)" })).toBeEnabled();
  });

  it("claims in one batch from the smart account: collect, claim ETH, claim the token", async () => {
    setFees({ eth: { [lc(SMA)]: E }, uncollectedTokens: 100n * E });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^creatorFees\.claimBoth/ }));

    await waitFor(() => expect(write.send).toHaveBeenCalledTimes(1));
    const [[batches]] = write.send.mock.calls;
    expect(batches).toHaveLength(1);
    expect(batches[0].sender).toEqual({ account: SMA, mode: "smart" });
    expect(decode(batches[0].calls)).toEqual([
      ["collectFees", TOKEN],
      ["claimEth", SMA],
      ["claimToken", TOKEN, SMA],
    ]);

    const status = await screen.findByRole("status");
    expect(within(status).getByText("creatorFees.claimedBoth(eth=1,tokens=88,symbol=POND)")).toBeInTheDocument();
    expect(within(status).getByRole("link", { name: "creatorFees.viewTransaction" })).toHaveAttribute(
      "href",
      "https://sepolia.basescan.org/tx/0xhash",
    );
  });

  // On a desktop wallet executeBatch sends from the smart account; fees credited
  // to the EOA can only be claimed by the EOA, so it sends (and pays gas) itself.
  it("claims fees credited to a desktop wallet's EOA from the EOA, and says it pays gas", async () => {
    setFees({ recipient: EOA, eth: { [lc(EOA)]: E, [lc(SMA)]: 0n } });
    setup();
    expect(screen.getByText(`creatorFees.captionEoa(address=0x6666…6666)`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^creatorFees\.claimEth/ }));
    await waitFor(() => expect(write.send).toHaveBeenCalled());
    const [[[batch]]] = write.send.mock.calls;
    expect(batch.sender).toEqual({ account: EOA, mode: "eoa" });
    expect(decode(batch.calls)).toEqual([["claimEth", EOA]]);
  });

  it("with no fees yet, says how they are earned and disables the button", () => {
    setFees();
    setup();
    expect(
      screen.getByText("creatorFees.emptyBody(share=88,fee=1,name=Frog Pond,symbol=POND)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "creatorFees.nothingToClaim" })).toBeDisabled();
    // The recipient can still hand fees on before any arrive.
    expect(screen.getByRole("button", { name: "creatorFees.transfer" })).toBeEnabled();
  });

  it("reports a failed claim", () => {
    setFees({ eth: { [lc(SMA)]: E } });
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
      fireEvent.change(field(), { target: { value: SMA.toLowerCase() } });
      expect(screen.getByText("creatorFees.transferDialog.errors.same")).toBeInTheDocument();
      expect(submit()).toBeDisabled();
    });

    it("collects first, then hands future fees on, and says where they go", async () => {
      setFees({ uncollectedEth: E });
      setup();
      openDialog();
      fireEvent.change(field(), { target: { value: OTHER.toLowerCase() } });
      expect(submit()).toBeEnabled();
      fireEvent.click(submit());

      await waitFor(() => expect(write.send).toHaveBeenCalled());
      const [[[batch]]] = write.send.mock.calls;
      expect(batch.sender).toEqual({ account: SMA, mode: "smart" });
      expect(decode(batch.calls)).toEqual([
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
