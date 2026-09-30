import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import ActivityTicker from "@/components/layout/ActivityTicker";
import { useActivityFeed } from "@/hooks/useLaunchActivity";

vi.mock("@/hooks/useLaunchActivity", () => ({ useActivityFeed: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const WALLET = "0x3f000000000000000000000000000000000000a1";

const feed = {
  tokens: [
    { kind: "buy", at: "2026-09-30T00:00:02Z", who: WALLET, token: TOKEN, symbol: "POND", ethAmount: "400000000000000000", priceWei: "47000000000", txHash: "0x1" },
    { kind: "launch", at: "2026-09-30T00:00:01Z", who: WALLET, token: TOKEN, symbol: "SALT", fdvWei: "1000000000000000000", txHash: "0x2" },
  ],
  raffles: [{ kind: "entry", at: "2026-09-30T00:00:00Z", who: WALLET, tickets: "40", txHash: "0x3", seasonId: 2, seasonName: null, token: TOKEN, symbol: "LAMP" }],
};

const setup = ({ data = feed, isError = false, compact = false } = {}) => {
  useActivityFeed.mockReturnValue({ data, isError });
  return render(
    <MemoryRouter>
      <ActivityTicker compact={compact} />
    </MemoryRouter>,
  );
};

describe("ActivityTicker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a tokens row and a raffles row, each item linked to its token or season", () => {
    setup();
    const bar = screen.getByRole("region", { name: "ticker.label" });
    expect(within(bar).getByText("TICKER.TOKENS")).toBeInTheDocument();
    expect(within(bar).getByText("TICKER.RAFFLES")).toBeInTheDocument();
    // Only the first copy of each loop is reachable; the second is aria-hidden.
    const links = within(bar).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/tokens/${TOKEN}`, `/tokens/${TOKEN}`, "/raffles/2"]);
  });

  it("keeps the loop's duplicate copy out of the tab order", () => {
    setup();
    const hidden = document.querySelectorAll('ul[aria-hidden="true"] a');
    expect(hidden.length).toBe(3);
    hidden.forEach((a) => expect(a).toHaveAttribute("tabindex", "-1"));
  });

  it("the pause button stops both rows and becomes a resume button", () => {
    setup();
    const pause = screen.getByRole("button", { name: "ticker.pause" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pause);
    screen.getAllByTestId("ticker-track").forEach((track) => expect(track).toHaveAttribute("data-paused", "true"));
    expect(screen.getByRole("button", { name: "ticker.resume" })).toHaveAttribute("aria-pressed", "true");
  });

  it("drops the wallet and the tail in the compact (mobile) layout, and keeps the row labels for screen readers", () => {
    setup({ compact: true });
    expect(screen.queryByText("TICKER.TOKENS")).not.toBeInTheDocument();
    expect(screen.getByText("ticker.tokens")).toHaveClass("sr-only");
    expect(screen.queryByText(/^0x3f/)).not.toBeInTheDocument();
    expect(screen.queryByText("ticker.fdv")).not.toBeInTheDocument();
  });

  describe("compact rendering of raffle items", () => {
    const raffleFeed = (rows) => ({ tokens: [], raffles: rows });
    const at = "2026-09-30T00:00:00Z";
    const season = { seasonId: 3, seasonName: null, token: null, symbol: null };
    const firstItem = () => document.querySelector("ul:not([aria-hidden]) li a");

    it("leaves no dangling separator on an entry, a closing season, or a win", () => {
      setup({
        compact: true,
        data: raffleFeed([
          { ...season, kind: "entry", at, who: WALLET, tickets: "40", txHash: "0x3" },
          { ...season, kind: "closing", at, endsAt: Math.floor(Date.now() / 1000) + 600, participants: "12" },
          { ...season, kind: "won", at, who: WALLET, prizePool: "1000" },
        ]),
      });
      expect(screen.queryAllByText("ticker.separator")).toHaveLength(0);
      const items = document.querySelectorAll("ul:not([aria-hidden]) li a");
      items.forEach((a) => expect(a.textContent).not.toMatch(/·\s*$/));
    });

    it("an entry still says which season it entered", () => {
      setup({ compact: true, data: raffleFeed([{ ...season, kind: "entry", at, who: WALLET, tickets: "40", txHash: "0x3" }]) });
      expect(firstItem().textContent).toBe("ticker.enteredraffle.season");
    });

    it("a closing season still says which season and when", () => {
      setup({
        compact: true,
        data: raffleFeed([{ ...season, kind: "closing", at, endsAt: Math.floor(Date.now() / 1000) + 600, participants: "12" }]),
      });
      expect(firstItem().textContent).toBe("ticker.closingraffle.seasonticker.inTime");
    });

    it("a win with no symbol shows the season rather than a bare 'won'", () => {
      setup({ compact: true, data: raffleFeed([{ ...season, kind: "won", at, who: WALLET, prizePool: "1000" }]) });
      expect(firstItem().textContent).toBe("ticker.wonraffle.season");
    });

    it("the full layout draws a separator only in front of a tail", () => {
      setup({
        data: raffleFeed([
          { ...season, kind: "entry", at, who: WALLET, tickets: "40", txHash: "0x3" },
          { ...season, kind: "opened", at },
        ]),
      });
      const [entry, opened] = document.querySelectorAll("ul:not([aria-hidden]) li a");
      expect(within(entry).getAllByText("ticker.separator")).toHaveLength(1);
      expect(within(entry).getByText("ticker.separator")).toHaveAttribute("aria-hidden", "true");
      expect(within(opened).queryByText("ticker.separator")).not.toBeInTheDocument();
    });
  });

  it("renders one wallet's two entries in one transaction as two items", () => {
    const entry = { kind: "entry", at: "2026-09-30T00:00:00Z", who: WALLET, tickets: "1", txHash: "0x3", seasonId: 2, seasonName: null, token: TOKEN, symbol: "LAMP" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ data: { tokens: [], raffles: [entry, entry] } });
    const bar = screen.getByRole("region", { name: "ticker.label" });
    expect(within(bar).getAllByRole("link")).toHaveLength(2);
    // No duplicate-key warning from React.
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("shows a row's empty text when only the other row has activity", () => {
    setup({ data: { tokens: feed.tokens, raffles: [] } });
    expect(screen.getByText("ticker.rafflesEmpty")).toBeInTheDocument();
  });

  it("renders nothing when both rows are empty, while loading, or when the first read fails", () => {
    const { container, unmount } = setup({ data: { tokens: [], raffles: [] } });
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(setup({ data: null }).container).toBeEmptyDOMElement();
    expect(setup({ data: null, isError: true }).container).toBeEmptyDOMElement();
  });

  it("keeps showing the last data when a refetch fails", () => {
    setup({ isError: true });
    expect(screen.getByRole("region", { name: "ticker.label" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  describe("a sparse feed", () => {
    // Lay out a 1000px row and 100px per item, so one pass of the tokens row
    // (2 items) is 200px and of the raffles row (1 item) is 100px.
    const ROW = 1000;
    const ITEM = 100;
    let matchMedia;

    beforeEach(() => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () {
        return this.firstElementChild?.dataset?.testid === "ticker-track" ? ROW : 0;
      });
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function () {
        return this.tagName === "UL" ? this.children.length * ITEM : 0;
      });
      matchMedia = window.matchMedia;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      window.matchMedia = matchMedia;
    });

    const copies = () => [...document.querySelectorAll('[data-testid="ticker-track"]')].map((track) => [...track.children]);

    it("repeats items inside each copy until a copy spans the row, capped", () => {
      setup();
      const [tokens, raffles] = copies();
      // 1000 / 200 = 5 passes of 2 items; 1000 / 100 = 10 passes of 1 item (the cap).
      tokens.forEach((ul) => expect(ul.children).toHaveLength(10));
      raffles.forEach((ul) => expect(ul.children).toHaveLength(10));
    });

    it("exposes only the first instance of each item to assistive tech and the tab order", () => {
      setup();
      const bar = screen.getByRole("region", { name: "ticker.label" });
      const links = within(bar).getAllByRole("link");
      expect(links.map((a) => a.getAttribute("href"))).toEqual([`/tokens/${TOKEN}`, `/tokens/${TOKEN}`, "/raffles/2"]);
      const focusable = bar.querySelectorAll('a:not([tabindex="-1"])');
      expect(focusable).toHaveLength(3);
      // Every repeat in the visible copy is hidden, as is the whole second copy.
      const [tokens, raffles] = copies();
      const exposed = (ul) => [...ul.children].filter((li) => !li.hasAttribute("aria-hidden"));
      expect(exposed(tokens[0])).toEqual([...tokens[0].children].slice(0, 2));
      expect(exposed(raffles[0])).toEqual([...raffles[0].children].slice(0, 1));
      [tokens[1], raffles[1]].forEach((ul) => expect(ul).toHaveAttribute("aria-hidden", "true"));
    });

    it("does not repeat when motion is reduced, where the row stands still", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });
      setup();
      const [tokens, raffles] = copies();
      expect(tokens[0].children).toHaveLength(2);
      expect(raffles[0].children).toHaveLength(1);
    });
  });
});
