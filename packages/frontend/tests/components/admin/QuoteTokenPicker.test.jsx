// tests/components/admin/QuoteTokenPicker.test.jsx
// The "Priced in" picker, driven by the real useQuoteTokenChoice over mocked
// reads: its groups and their order, the chosen token on the closed trigger,
// and a pasted (or preselected) address checked the way the contract checks it.
import { render, screen, fireEvent, within, renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

import QuoteTokenPicker from "@/components/admin/QuoteTokenPicker";
import { useQuoteTokenChoice, NEWEST_LAUNCH_OPTIONS } from "@/hooks/useQuoteTokenChoice";
import { useTokenLaunches, useTokenLaunch } from "@/hooks/useTokenLaunches";
import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";
import { useQuoteTokenInfo } from "@/hooks/useQuoteTokenInfo";

const MY_SMA = "0x00000000000000000000000000000000000000Ea";
const OTHER = "0x00000000000000000000000000000000000000f0";
const PLATFORM = "0x5050505050505050505050505050505050505050";
const APPROVED = "0x7070707070707070707070707070707070707070";
const NEITHER = "0x9090909090909090909090909090909090909090";
const OLD_LAUNCH = "0x8080808080808080808080808080808080808080";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0x00000000000000000000000000000000000000e0" }) }));
vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({
    eoa: "0x00000000000000000000000000000000000000e0",
    sma: "0x00000000000000000000000000000000000000Ea",
  }),
}));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    QUOTE_TOKEN: "0x5050505050505050505050505050505050505050",
    RAFFLE: "0x00000000000000000000000000000000000000a1",
    TOKEN_LAUNCHPAD: "0x00000000000000000000000000000000000000b2",
  }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/hooks/useTokenLaunches", () => ({ useTokenLaunches: vi.fn(), useTokenLaunch: vi.fn() }));
vi.mock("@/hooks/useLaunchMarkets", () => ({ useLaunchMarkets: vi.fn() }));
vi.mock("@/hooks/useQuoteTokenInfo", () => ({ useQuoteTokenInfo: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key) }),
}));

// Radix Select in jsdom.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

const ETH = 10n ** 18n;
const GWEI = 10n ** 9n;
const NOW = Math.floor(Date.now() / 1000);
const tokenAt = (i) => `0x${String(i).padStart(2, "0").repeat(20)}`;

/** Newest first, like useTokenLaunches. Launch 2 is mine (by my smart account, in other case). */
const LAUNCHES = Array.from({ length: 12 }, (_, i) => ({
  launchId: 12 - i,
  token: tokenAt(12 - i),
  creator: 12 - i === 2 ? MY_SMA.toUpperCase().replace("0X", "0x") : OTHER,
  launchedAt: BigInt(NOW - (i + 1) * 3600),
  name: `Token ${12 - i}`,
  symbol: `T${12 - i}`,
  placementId: "0x01",
}));

const INFO = {
  [PLATFORM.toLowerCase()]: { eligible: true, kind: "approved", name: "Second Order", symbol: "SOF", decimals: 18 },
  [APPROVED.toLowerCase()]: { eligible: true, kind: "approved", name: "USD Coin", symbol: "USDC", decimals: 6 },
  [NEITHER.toLowerCase()]: { eligible: false, kind: null, name: "Random", symbol: "RND", decimals: 18 },
  [OLD_LAUNCH.toLowerCase()]: { eligible: true, kind: "launch", name: "Old Frog", symbol: "OLDF", decimals: 18 },
};

const setupReads = ({ launches = LAUNCHES, markets = {}, pending = [], failing = [] } = {}) => {
  useTokenLaunches.mockReturnValue({ launches, isLoading: false });
  useTokenLaunch.mockImplementation((addr) => ({
    data: addr && addr.toLowerCase() === OLD_LAUNCH.toLowerCase() ? { token: OLD_LAUNCH, launchedAt: BigInt(NOW - 86400 * 30), placementId: "0x02" } : undefined,
  }));
  useLaunchMarkets.mockReturnValue({ markets });
  useQuoteTokenInfo.mockImplementation((addr) => {
    if (!addr) return { data: undefined, isError: false };
    const key = addr.toLowerCase();
    if (pending.includes(key)) return { data: undefined, isError: false };
    if (failing.includes(key)) return { data: undefined, isError: true };
    return { data: INFO[key] ?? { eligible: false, kind: null, name: "", symbol: "", decimals: 18 }, isError: false };
  });
};

/** The real hook feeding the picker, as the forms wire it. */
const Harness = ({ initialToken, onChoice }) => {
  const choice = useQuoteTokenChoice({ initialToken });
  onChoice?.(choice);
  return <QuoteTokenPicker choice={choice} />;
};

const renderPicker = (props = {}) => {
  let latest;
  const utils = render(<Harness {...props} onChoice={(c) => (latest = c)} />);
  return { ...utils, choice: () => latest };
};

const openList = () => {
  const trigger = screen.getByRole("combobox", { name: "quoteToken.label" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("listbox");
};

describe("useQuoteTokenChoice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("groups: my launches (EOA or smart account, any case), then the platform's approved tokens, then the newest others", () => {
    setupReads();
    const { result } = renderHook(() => useQuoteTokenChoice());
    const { yours, approved, newest } = result.current.groups;
    expect(yours.map((o) => o.symbol)).toEqual(["T2"]);
    expect(approved).toEqual([expect.objectContaining({ address: PLATFORM, symbol: "SOF", kind: "approved", isPlatformDefault: true })]);
    // Newest first, without the launch already listed under mine, capped.
    expect(newest).toHaveLength(NEWEST_LAUNCH_OPTIONS);
    expect(newest[0].symbol).toBe("T12");
    expect(newest.some((o) => o.symbol === "T2")).toBe(false);
  });

  it("starts on the platform default, eligible and unblocked", () => {
    setupReads();
    const { result } = renderHook(() => useQuoteTokenChoice());
    expect(result.current.selected).toMatchObject({ address: PLATFORM, isPlatformDefault: true });
    expect(result.current).toMatchObject({ status: "eligible", blocked: false, quoteToken: PLATFORM, source: "default" });
  });

  it("a list pick becomes the quote token and clears any pasted text", () => {
    setupReads();
    const { result } = renderHook(() => useQuoteTokenChoice());
    act(() => result.current.setPasteText("0x12"));
    act(() => result.current.selectFromList(tokenAt(9)));
    expect(result.current).toMatchObject({ quoteToken: tokenAt(9), source: "list", pasteText: "", blocked: false });
    expect(result.current.selected).toMatchObject({ symbol: "T9", kind: "launch", decimals: 18 });
  });

  it("carries a launch token's live FDV and pool price", () => {
    setupReads({ markets: { [tokenAt(9)]: { fdvWei: 47_200_000_000_000_000_000n, priceWei: 47n * GWEI } } });
    const { result } = renderHook(() => useQuoteTokenChoice());
    act(() => result.current.selectFromList(tokenAt(9)));
    expect(result.current.selected).toMatchObject({ fdvWei: 47_200_000_000_000_000_000n, priceWei: 47n * GWEI });
  });

  it("a pasted approved token is chosen with its own decimals", () => {
    setupReads();
    const { result } = renderHook(() => useQuoteTokenChoice());
    act(() => result.current.setPasteText(`  ${APPROVED.toLowerCase()} `));
    expect(result.current).toMatchObject({ status: "eligible", blocked: false, source: "paste", quoteToken: APPROVED });
    expect(result.current.selected).toMatchObject({ symbol: "USDC", kind: "approved", decimals: 6 });
  });

  it("a pasted token that is neither launched nor approved blocks, and is never the quote token", () => {
    setupReads();
    const { result } = renderHook(() => useQuoteTokenChoice());
    act(() => result.current.setPasteText(NEITHER));
    expect(result.current).toMatchObject({ status: "ineligible", blocked: true, quoteToken: undefined });
  });

  it("blocks while the check is in flight, when it fails, and on text that is not an address", () => {
    setupReads({ pending: [APPROVED.toLowerCase()], failing: [NEITHER.toLowerCase()] });
    const { result } = renderHook(() => useQuoteTokenChoice());
    act(() => result.current.setPasteText(APPROVED));
    expect(result.current).toMatchObject({ status: "checking", blocked: true });
    act(() => result.current.setPasteText(NEITHER));
    expect(result.current).toMatchObject({ status: "error", blocked: true });
    act(() => result.current.setPasteText("0x1234"));
    expect(result.current).toMatchObject({ status: "invalid", blocked: true });
    // Clearing the paste goes back to the list's choice.
    act(() => result.current.setPasteText(""));
    expect(result.current).toMatchObject({ status: "eligible", quoteToken: PLATFORM });
  });

  it("preselects a token handed in (from ?quoteToken=) through the same check", () => {
    setupReads({ markets: { [OLD_LAUNCH.toLowerCase()]: { fdvWei: 3n * ETH, priceWei: 3n * GWEI } } });
    const { result } = renderHook(() => useQuoteTokenChoice({ initialToken: OLD_LAUNCH }));
    expect(useQuoteTokenInfo).toHaveBeenCalledWith(OLD_LAUNCH);
    expect(result.current).toMatchObject({ status: "eligible", quoteToken: OLD_LAUNCH, pasteText: OLD_LAUNCH });
    // Older than the loaded page of launches, it is still priced.
    expect(useLaunchMarkets.mock.lastCall[0].some((l) => l.token === OLD_LAUNCH)).toBe(true);
    expect(result.current.selected).toMatchObject({ kind: "launch", symbol: "OLDF", priceWei: 3n * GWEI });
  });

  it("a preselected token that is not allowed blocks", () => {
    setupReads();
    const { result } = renderHook(() => useQuoteTokenChoice({ initialToken: NEITHER }));
    expect(result.current).toMatchObject({ status: "ineligible", blocked: true, quoteToken: undefined });
  });
});

describe("QuoteTokenPicker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("labels the field, explains it, and shows the platform default on the closed trigger", () => {
    setupReads();
    renderPicker();
    const trigger = screen.getByRole("combobox", { name: "quoteToken.label" });
    expect(within(trigger).getByText("Second Order")).toBeInTheDocument();
    expect(within(trigger).getByText('quoteToken.symbol{"symbol":"SOF"}')).toHaveClass("font-mono");
    expect(within(trigger).getByText("quoteToken.metaPlatform")).toBeInTheDocument();
    expect(screen.getByText("quoteToken.help")).toBeInTheDocument();
  });

  it("shows a launch token on the trigger with its FDV", () => {
    setupReads({ markets: { [tokenAt(9)]: { fdvWei: 47_200_000_000_000_000_000n, priceWei: 47n * GWEI } } });
    const { choice } = renderPicker();
    act(() => choice().selectFromList(tokenAt(9)));
    const trigger = screen.getByRole("combobox", { name: "quoteToken.label" });
    expect(within(trigger).getByText("Token 9")).toBeInTheDocument();
    expect(within(trigger).getByText('quoteToken.metaLaunch{"fdv":"47.2"}')).toBeInTheDocument();
  });

  it("lists my launches, then the platform's approved tokens, then the newest launches, with separators", () => {
    setupReads({ markets: { [tokenAt(12)]: { fdvWei: 2n * ETH, priceWei: 2n * GWEI } } });
    renderPicker();
    const list = openList();
    const groups = within(list).getAllByRole("group");
    expect(groups.map((g) => g.firstChild.textContent)).toEqual([
      "quoteToken.groupYours",
      "quoteToken.groupApproved",
      "quoteToken.groupNewest",
    ]);
    expect(within(groups[0]).getAllByRole("option")).toHaveLength(1);
    expect(within(groups[0]).getByText("Token 2")).toBeInTheDocument();
    expect(within(groups[1]).getByText("Second Order")).toBeInTheDocument();
    expect(within(groups[1]).getByText("quoteToken.metaPlatform")).toBeInTheDocument();
    expect(within(groups[2]).getAllByRole("option")).toHaveLength(NEWEST_LAUNCH_OPTIONS);
    // Each launch: art, name, $SYMBOL and FDV · age.
    const newest = within(groups[2]).getAllByRole("option")[0];
    expect(within(newest).getByText("Token 12")).toBeInTheDocument();
    expect(within(newest).getByText('quoteToken.symbol{"symbol":"T12"}')).toBeInTheDocument();
    expect(within(newest).getByText('quoteToken.itemMeta{"fdv":"2","age":"1h"}')).toBeInTheDocument();
    expect(within(newest).getByText("T")).toBeInTheDocument(); // the monogram art
    // SelectSeparator is a decorative (aria-hidden) rule between groups.
    const separators = list.querySelectorAll('[aria-hidden="true"].h-px');
    expect(separators).toHaveLength(2);
    expect(separators[0].nextElementSibling).toBe(groups[1]);
    expect(separators[1].nextElementSibling).toBe(groups[2]);
  });

  it("drops an empty group and its separator", () => {
    setupReads({ launches: LAUNCHES.filter((l) => l.symbol !== "T2") });
    renderPicker();
    const groups = within(openList()).getAllByRole("group");
    expect(groups.map((g) => g.firstChild.textContent)).toEqual(["quoteToken.groupApproved", "quoteToken.groupNewest"]);
  });

  it("choosing an item selects it", () => {
    setupReads();
    const { choice } = renderPicker();
    const list = openList();
    fireEvent.click(within(list).getByRole("option", { name: /Token 5/ }));
    expect(choice().quoteToken).toBe(tokenAt(5));
  });

  it("paste, eligible: a resolved row with its badge, and the trigger follows", () => {
    setupReads();
    const { choice } = renderPicker();
    fireEvent.change(screen.getByLabelText("quoteToken.pasteLabel"), { target: { value: APPROVED } });
    expect(screen.getByText("quoteToken.badgeApproved")).toBeInTheDocument();
    expect(within(screen.getByRole("combobox", { name: "quoteToken.label" })).getByText("USD Coin")).toBeInTheDocument();
    expect(screen.queryByText("quoteToken.notAllowed")).not.toBeInTheDocument();
    expect(choice().quoteToken).toBe(APPROVED);
  });

  it("paste, a launch token: badged as one", () => {
    setupReads();
    renderPicker();
    fireEvent.change(screen.getByLabelText("quoteToken.pasteLabel"), { target: { value: OLD_LAUNCH } });
    expect(screen.getByText("quoteToken.badgeLaunch")).toBeInTheDocument();
  });

  it("paste, ineligible: says why, marks the input invalid, and resolves nothing", () => {
    setupReads();
    const { choice } = renderPicker();
    const input = screen.getByLabelText("quoteToken.pasteLabel");
    fireEvent.change(input, { target: { value: NEITHER } });
    expect(screen.getByRole("alert")).toHaveTextContent("quoteToken.notAllowed");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("quoteToken.badgeApproved")).not.toBeInTheDocument();
    expect(screen.queryByText("quoteToken.badgeLaunch")).not.toBeInTheDocument();
    expect(choice().blocked).toBe(true);
  });

  it("paste, still checking: a status, not an error", () => {
    setupReads({ pending: [APPROVED.toLowerCase()] });
    renderPicker();
    const input = screen.getByLabelText("quoteToken.pasteLabel");
    fireEvent.change(input, { target: { value: APPROVED } });
    expect(screen.getByRole("status")).toHaveTextContent("quoteToken.checking");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("preselected from the query param: shown in the paste box and resolved", () => {
    setupReads();
    renderPicker({ initialToken: OLD_LAUNCH });
    expect(screen.getByLabelText("quoteToken.pasteLabel")).toHaveValue(OLD_LAUNCH);
    expect(screen.getByText("quoteToken.badgeLaunch")).toBeInTheDocument();
    expect(within(screen.getByRole("combobox", { name: "quoteToken.label" })).getByText("Old Frog")).toBeInTheDocument();
  });
});
